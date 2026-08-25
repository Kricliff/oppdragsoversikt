// Cloudflare Pages Function - viser sanntid busstider fra en holdeplass nær kontoret.
// Ruter er del av Entur-samarbeidet, og Entur sitt JourneyPlanner-API er gratis og
// krever ingen nøkkel - bare en ET-Client-Name-header for identifikasjon
// (se https://developer.entur.org).

const STOP_PLACE_ID = "NSR:StopPlace:4055"; // Wessels plass, Oslo (nær Rådhusgata 23)
const ANTALL_AVGANGER = 6;
const CACHE_SECONDS = 45; // sanntid - kort cache, i motsetning til Recman-proxyen
const CACHE_VERSION = 1;

const QUERY = `{
  stopPlace(id: "${STOP_PLACE_ID}") {
    name
    estimatedCalls(timeRange: 72000, numberOfDepartures: ${ANTALL_AVGANGER}) {
      realtime
      expectedDepartureTime
      destinationDisplay { frontText }
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

  const avganger = (json.data?.stopPlace?.estimatedCalls ?? []).map((call) => ({
    linje: call.serviceJourney.line.publicCode,
    transportmodus: call.serviceJourney.line.transportMode,
    destinasjon: call.destinationDisplay.frontText,
    avgangstid: call.expectedDepartureTime,
    sanntid: call.realtime
  }));

  return { holdeplass: json.data?.stopPlace?.name ?? "Wessels plass", avganger };
}
