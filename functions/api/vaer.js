// Cloudflare Pages Function - værmelding for Oslo fra MET (Yr) sitt gratis,
// nøkkelfrie API. Krever kun en identifiserende User-Agent-header per MET sine
// bruksvilkår (se https://api.met.no/doc/TermsOfService).

const LAT = 59.9139;
const LON = 10.7522; // Oslo sentrum
const CACHE_SECONDS = 30 * 60; // MET oppdaterer værdata typisk hver time
const CACHE_VERSION = 1;

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/vaer?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await hentVaer();
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

async function hentVaer() {
  const res = await fetch(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`,
    { headers: { "User-Agent": "oppdragsoversikt/1.0 github.com/Kricliff/oppdragsoversikt" } }
  );
  const json = await res.json();
  const forste = json.properties?.timeseries?.[0];
  if (!forste) throw new Error("Uventet svar fra MET");

  const symbolKode =
    forste.data.next_1_hours?.summary?.symbol_code ??
    forste.data.next_6_hours?.summary?.symbol_code ??
    null;

  return {
    temperatur: Math.round(forste.data.instant.details.air_temperature),
    symbolKode
  };
}
