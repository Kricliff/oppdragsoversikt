// Cloudflare Pages Function - værmelding for Oslo fra MET (Yr) sitt gratis,
// nøkkelfrie API. Krever kun en identifiserende User-Agent-header per MET sine
// bruksvilkår (se https://api.met.no/doc/TermsOfService).

const LAT = 59.9139;
const LON = 10.7522; // Oslo sentrum
const CACHE_SECONDS = 30 * 60; // MET oppdaterer værdata typisk hver time
const CACHE_VERSION = 3;
const NEDBOR_TERSKEL_MM = 0.2; // under dette regnes det som ubetydelig duskregn
const OSLO_TZ = "Europe/Oslo";

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

  // Paraply-varsel: regn nå ELLER innen et par timer - begge sjekkes siden
  // next_1_hours alene ikke fanger opp regn som starter litt senere.
  const nedbor1t = forste.data.next_1_hours?.details?.precipitation_amount ?? 0;
  const nedbor6t = forste.data.next_6_hours?.details?.precipitation_amount ?? 0;
  const taMedParaply = nedbor1t >= NEDBOR_TERSKEL_MM || nedbor6t >= NEDBOR_TERSKEL_MM;

  return {
    temperatur: Math.round(forste.data.instant.details.air_temperature),
    symbolKode,
    taMedParaply,
    varsel3dager: dagsvarsel(json.properties.timeseries)
  };
}

// Grupperer timeseries-punktene på kalenderdato (Oslo-tid) og lager ett sammendrag per
// dag: min/maks temperatur for hele dagen, og et symbol hentet fra punktet nærmest
// midt på dagen (klokken 12) siden det best representerer "værtypen" for dagen som
// helhet - MET sitt "compact"-format har kun next_6_hours-sammendrag på hele
// klokkeslett (00/06/12/18), så nøyaktig kl. 12 finnes nesten alltid.
function dagsvarsel(timeseries) {
  const idagIso = new Date().toLocaleDateString("en-CA", { timeZone: OSLO_TZ });
  const dager = new Map();

  for (const punkt of timeseries) {
    const tid = new Date(punkt.time);
    const dagIso = tid.toLocaleDateString("en-CA", { timeZone: OSLO_TZ });
    const time = Number(tid.toLocaleTimeString("en-GB", { timeZone: OSLO_TZ, hour: "2-digit", hour12: false }));

    if (!dager.has(dagIso)) dager.set(dagIso, { temps: [], midtpunkt: null, midtDiff: Infinity });
    const dag = dager.get(dagIso);

    dag.temps.push(punkt.data.instant.details.air_temperature);

    const symbol = punkt.data.next_6_hours?.summary?.symbol_code ?? punkt.data.next_1_hours?.summary?.symbol_code;
    const diff = Math.abs(time - 12);
    if (symbol && diff < dag.midtDiff) {
      dag.midtpunkt = symbol;
      dag.midtDiff = diff;
    }
  }

  return [...dager.entries()]
    .filter(([dagIso]) => dagIso > idagIso)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 3)
    .map(([dagIso, dag]) => ({
      ukedag: new Date(`${dagIso}T12:00:00`).toLocaleDateString("no-NO", { weekday: "short", timeZone: OSLO_TZ }),
      symbolKode: dag.midtpunkt,
      min: Math.round(Math.min(...dag.temps)),
      maks: Math.round(Math.max(...dag.temps))
    }));
}
