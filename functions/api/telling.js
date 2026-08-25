// Cloudflare Pages Function - ekte telling av telefoner og salgsmøter fra Recman sin
// "log"-scope (CRM-aktivitetslogg). Nullstilles automatisk ved ny måned.
//
// Recman har ikke noe "gi meg logg for periode X"-filter - kun minLogId (en stigende
// global teller på tvers av alle logg-typer). Vi lagrer derfor en løpende "cursor"
// (sisteLogId) i KV og henter kun NYE rader siden forrige kall, i stedet for å scanne
// hele loggen på nytt hver gang.

// v2 (2026-08-25): telefonsamtaler uten tilknyttet bedrift (rene kandidat-samtaler)
// telles ikke lenger med - bekreftet mot Recman sin egen "Aktiviteter"-widget at disse
// aldri er del av det tallet. KV-nøkkelen er bumpet slik at tellingen regnes helt på
// nytt med den nye regelen, i stedet for å videreføre gamle (for høye) tall.
const KV_KEY = "telling-log-v2";
// Konservativt startpunkt for aller første kjøring - godt før inneværende måned starter,
// slik at ingenting fra denne måneden går tapt. Brukes kun én gang (før KV har egen
// lagret cursor); etter det styrer sisteLogId seg selv videre.
const START_LOG_ID = 77150000;
const CACHE_SECONDS = 5 * 60;
const CACHE_VERSION = 2;

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/telling?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await oppdaterOgHentTelling(context.env.RECMAN_API_KEY, context.env.NOTAT_KV);
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

async function oppdaterOgHentTelling(apiKey, kv) {
  const gjeldendeMaaned = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  let tilstand = await kv.get(KV_KEY, "json");
  if (!tilstand) {
    tilstand = { maaned: gjeldendeMaaned, sisteLogId: START_LOG_ID, telefoner: 0, moter: 0 };
  }
  if (tilstand.maaned !== gjeldendeMaaned) {
    // Ny måned - nullstill tellerne, men behold cursor slik at vi ikke leser hele
    // loggen på nytt.
    tilstand = { maaned: gjeldendeMaaned, sisteLogId: tilstand.sisteLogId, telefoner: 0, moter: 0 };
  }

  const nyeRader = await hentNyeLoggRader(apiKey, tilstand.sisteLogId + 1, (nyCursor) => {
    tilstand.sisteLogId = nyCursor;
  });

  nyeRader
    .filter((r) => r.created && r.created.slice(0, 7) === gjeldendeMaaned)
    .filter((r) => Boolean(r.companyId)) // kandidat-samtaler uten bedrift telles ikke
    .forEach((r) => {
      if (r.type === "phone") tilstand.telefoner++;
      if (r.type === "salesMeeting") tilstand.moter++;
    });

  await kv.put(KV_KEY, JSON.stringify(tilstand));
  return { telefoner: tilstand.telefoner, moter: tilstand.moter };
}

// Recman gir maks 1000 rader per kall - løkker til alt nytt er hentet (i praksis
// nesten alltid én runde, siden dette kjører med noen minutters mellomrom).
async function hentNyeLoggRader(apiKey, startId, oppdaterCursor) {
  const alleRader = [];
  let minLogId = startId;

  for (let runde = 0; runde < 20; runde++) {
    const url = `https://api.recman.io/v2/get/?key=${apiKey}&scope=log&minLogId=${minLogId}`;
    const json = await fetch(url).then((r) => r.json());
    if (!json.success || !json.data) break;

    const rader = Object.values(json.data);
    if (rader.length === 0) break;

    alleRader.push(...rader);
    const maxId = Math.max(...rader.map((r) => Number(r.logId)));
    oppdaterCursor(maxId);

    if (rader.length < 1000) break; // siste side
    minLogId = maxId + 1;
  }

  return alleRader;
}
