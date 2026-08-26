// Cloudflare Pages Function - viser sanntid avganger fra fire holdeplasser nær kontoret:
// buss fra Wessels plass, tog fra Nasjonaltheatret (begge retninger), trikk fra Øvre
// Slottsgate, og T-bane fra Stortinget. Ruter er del av Entur-samarbeidet, og Entur sitt
// JourneyPlanner-API er gratis og krever ingen nøkkel - bare en ET-Client-Name-header for
// identifikasjon (se https://developer.entur.org).

const WESSELS_PLASS_ID = "NSR:StopPlace:4055"; // Wessels plass, Oslo (nær Rådhusgata 23)
const NASJONALTEATRET_ID = "NSR:StopPlace:58404"; // Nasjonaltheatret stasjon (tog)
const OVRE_SLOTTSGATE_ID = "NSR:StopPlace:61633"; // Øvre Slottsgate (trikk)
const STORTINGET_ID = "NSR:StopPlace:4029"; // Stortinget (T-bane)

const ANTALL_BUSSAVGANGER = 6;
const ANTALL_TOGAVGANGER_PER_RETNING = 6;
const ANTALL_TRIKKAVGANGER = 6;
const ANTALL_TBANEAVGANGER = 6;

// Rekker man uansett ikke avgangen på under X min fra kontoret - skjul den heller enn å
// vise noe urealistisk å nå. Ulik terskel per transportmiddel (T-bane/tog tar lenger å gå
// til enn buss/trikk rett utenfor). Henter derfor flere kandidater enn vist (se
// numberOfDepartures under) slik at det alltid er nok igjen etter filtrering.
const MIN_MIN_BUSS = 5;
const MIN_MIN_TOG = 10;
const MIN_MIN_TRIKK = 5;
const MIN_MIN_TBANE = 10;

const CACHE_SECONDS = 45; // sanntid - kort cache, i motsetning til Recman-proxyen
const CACHE_VERSION = 6;

// Entur har ikke noe eget "retning: øst/vest"-felt på estimatedCalls - spor 475/478 er
// vestgående (mot Drammen/Asker/Kongsberg) og spor 476/477 er østgående (mot Oslo S og
// videre mot Lillestrøm/Ski/Moss/Gardermoen). Funnet empirisk ved å sammenligne spor mot
// kjente sluttdestinasjoner - fysiske spor endrer seg ikke, så dette er stabilt.
const SPOR_MOT_DRAMMEN = new Set(["NSR:Quay:475", "NSR:Quay:478"]);
const SPOR_MOT_OSLO = new Set(["NSR:Quay:476", "NSR:Quay:477"]);

// Samme prinsipp for T-banen på Stortinget - spor 2 går vestover (mot Majorstuen og
// videre til Frognerseteren/Sognsvann/Røa/Kolsås/Østerås osv.), spor 1 og 3 går østover
// (mot Tøyen og videre til Ellingsrudåsen/Mortensrud/Bergkrystallen osv.). Funnet empirisk
// ved å sjekke destinasjon per spor over mange avganger.
const SPOR_VESTOVER = new Set(["NSR:Quay:7255"]);
const SPOR_OSTOVER = new Set(["NSR:Quay:7256", "NSR:Quay:7257"]);

const QUERY = `{
  wessels: stopPlace(id: "${WESSELS_PLASS_ID}") {
    name
    estimatedCalls(timeRange: 72000, numberOfDepartures: 15) {
      realtime
      expectedDepartureTime
      destinationDisplay { frontText }
      serviceJourney {
        line { publicCode transportMode }
      }
    }
  }
  nasjonaltheatret: stopPlace(id: "${NASJONALTEATRET_ID}") {
    name
    estimatedCalls(timeRange: 72000, numberOfDepartures: 30, whiteListedModes: [rail]) {
      realtime
      expectedDepartureTime
      destinationDisplay { frontText }
      quay { id }
      serviceJourney {
        line { publicCode transportMode }
      }
    }
  }
  ovreSlottsgate: stopPlace(id: "${OVRE_SLOTTSGATE_ID}") {
    name
    estimatedCalls(timeRange: 72000, numberOfDepartures: 20, whiteListedModes: [tram]) {
      realtime
      expectedDepartureTime
      destinationDisplay { frontText }
      serviceJourney {
        line { publicCode transportMode }
      }
    }
  }
  stortinget: stopPlace(id: "${STORTINGET_ID}") {
    name
    estimatedCalls(timeRange: 72000, numberOfDepartures: 30, whiteListedModes: [metro]) {
      realtime
      expectedDepartureTime
      destinationDisplay { frontText }
      quay { id }
      serviceJourney {
        line { publicCode transportMode }
      }
    }
  }
}`;

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/avganger?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await hentAvganger();
    const response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function hentAvganger() {
  const res = await fetch("https://api.entur.io/journey-planner/v3/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ET-Client-Name": "kricliff-oppdragsoversikt"
    },
    body: JSON.stringify({ query: QUERY })
  });
  const json = await res.json();
  if (json.errors) throw new Error("Entur-feil: " + JSON.stringify(json.errors));

  const avganger = (json.data?.wessels?.estimatedCalls ?? [])
    .filter((c) => erMinstXMinutterUnna(c, MIN_MIN_BUSS))
    .slice(0, ANTALL_BUSSAVGANGER)
    .map(tilAvgang);

  const togKall = (json.data?.nasjonaltheatret?.estimatedCalls ?? [])
    .filter((c) => erMinstXMinutterUnna(c, MIN_MIN_TOG));
  const togMotDrammen = togKall
    .filter((call) => SPOR_MOT_DRAMMEN.has(call.quay?.id))
    .slice(0, ANTALL_TOGAVGANGER_PER_RETNING)
    .map(tilAvgang);
  const togMotOslo = togKall
    .filter((call) => SPOR_MOT_OSLO.has(call.quay?.id))
    .slice(0, ANTALL_TOGAVGANGER_PER_RETNING)
    .map(tilAvgang);

  const trikk = (json.data?.ovreSlottsgate?.estimatedCalls ?? [])
    .filter((c) => erMinstXMinutterUnna(c, MIN_MIN_TRIKK))
    .slice(0, ANTALL_TRIKKAVGANGER)
    .map(tilAvgang);

  const tbaneKall = (json.data?.stortinget?.estimatedCalls ?? [])
    .filter((c) => erMinstXMinutterUnna(c, MIN_MIN_TBANE));
  const tbaneVestover = tbaneKall
    .filter((call) => SPOR_VESTOVER.has(call.quay?.id))
    .slice(0, ANTALL_TBANEAVGANGER)
    .map(tilAvgang);
  const tbaneOstover = tbaneKall
    .filter((call) => SPOR_OSTOVER.has(call.quay?.id))
    .slice(0, ANTALL_TBANEAVGANGER)
    .map(tilAvgang);

  return {
    holdeplass: json.data?.wessels?.name ?? "Wessels plass",
    avganger,
    tog: {
      holdeplass: json.data?.nasjonaltheatret?.name ?? "Nasjonaltheatret",
      motDrammen: togMotDrammen,
      motOslo: togMotOslo
    },
    trikk: {
      holdeplass: json.data?.ovreSlottsgate?.name ?? "Øvre Slottsgate",
      avganger: trikk
    },
    tbane: {
      holdeplass: json.data?.stortinget?.name ?? "Stortinget",
      vestover: tbaneVestover,
      ostover: tbaneOstover
    }
  };
}

function erMinstXMinutterUnna(call, minMinutter) {
  const minutter = (new Date(call.expectedDepartureTime).getTime() - Date.now()) / 60000;
  return minutter >= minMinutter;
}

function tilAvgang(call) {
  return {
    linje: call.serviceJourney.line.publicCode,
    transportmodus: call.serviceJourney.line.transportMode,
    destinasjon: call.destinationDisplay.frontText,
    avgangstid: call.expectedDepartureTime,
    sanntid: call.realtime
  };
}
