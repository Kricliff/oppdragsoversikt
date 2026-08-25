// Cloudflare Pages Function - viser sanntid avganger fra to holdeplasser nær kontoret:
// buss fra Wessels plass, og tog fra Nasjonaltheatret (begge retninger). Ruter er del av
// Entur-samarbeidet, og Entur sitt JourneyPlanner-API er gratis og krever ingen nøkkel -
// bare en ET-Client-Name-header for identifikasjon (se https://developer.entur.org).

const WESSELS_PLASS_ID = "NSR:StopPlace:4055"; // Wessels plass, Oslo (nær Rådhusgata 23)
const NASJONALTEATRET_ID = "NSR:StopPlace:58404"; // Nasjonaltheatret stasjon (tog)
const ANTALL_BUSSAVGANGER = 6;
const ANTALL_TOGAVGANGER_PER_RETNING = 6;
const CACHE_SECONDS = 45; // sanntid - kort cache, i motsetning til Recman-proxyen
const CACHE_VERSION = 3;

// Entur har ikke noe eget "retning: øst/vest"-felt på estimatedCalls - spor 475/478 er
// vestgående (mot Drammen/Asker/Kongsberg) og spor 476/477 er østgående (mot Oslo S og
// videre mot Lillestrøm/Ski/Moss/Gardermoen). Funnet empirisk ved å sammenligne spor mot
// kjente sluttdestinasjoner - fysiske spor endrer seg ikke, så dette er stabilt.
const SPOR_MOT_DRAMMEN = new Set(["NSR:Quay:475", "NSR:Quay:478"]);
const SPOR_MOT_OSLO = new Set(["NSR:Quay:476", "NSR:Quay:477"]);

const QUERY = `{
  wessels: stopPlace(id: "${WESSELS_PLASS_ID}") {
    name
    estimatedCalls(timeRange: 72000, numberOfDepartures: ${ANTALL_BUSSAVGANGER}) {
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

  const avganger = (json.data?.wessels?.estimatedCalls ?? []).map(tilAvgang);

  const togKall = json.data?.nasjonaltheatret?.estimatedCalls ?? [];
  const togMotDrammen = togKall
    .filter((call) => SPOR_MOT_DRAMMEN.has(call.quay?.id))
    .slice(0, ANTALL_TOGAVGANGER_PER_RETNING)
    .map(tilAvgang);
  const togMotOslo = togKall
    .filter((call) => SPOR_MOT_OSLO.has(call.quay?.id))
    .slice(0, ANTALL_TOGAVGANGER_PER_RETNING)
    .map(tilAvgang);

  return {
    holdeplass: json.data?.wessels?.name ?? "Wessels plass",
    avganger,
    tog: {
      holdeplass: json.data?.nasjonaltheatret?.name ?? "Nasjonaltheatret",
      motDrammen: togMotDrammen,
      motOslo: togMotOslo
    }
  };
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
