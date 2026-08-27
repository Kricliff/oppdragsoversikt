// Cloudflare Pages Function - henter siste overskrifter fra NRKs offentlige RSS-feed
// (toppsaker.rss) og returnerer dem som en enkel liste med ren tekst. Brukes til å
// fylle feiringsbanneret nederst med nyheter når det ikke er noen feiringer å vise.

const RSS_URL = "https://www.nrk.no/toppsaker.rss";
const CACHE_SECONDS = 10 * 60;
const CACHE_VERSION = 1;
const ANTALL_SAKER = 6;

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/nrk?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const overskrifter = await hentOverskrifter();
    const response = new Response(JSON.stringify({ overskrifter }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), overskrifter: [] }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function hentOverskrifter() {
  const res = await fetch(RSS_URL, { headers: { "User-Agent": "oppdragsoversikt-tavle" } });
  if (!res.ok) throw new Error(`NRK RSS svarte ${res.status}`);
  const xml = await res.text();

  const titler = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml)) && titler.length < ANTALL_SAKER) {
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemMatch[1]);
    if (!titleMatch) continue;
    const tittel = rensXmlTekst(titleMatch[1]);
    if (tittel) titler.push(tittel);
  }
  return titler;
}

function rensXmlTekst(raw) {
  let tekst = raw.trim();
  const cdataMatch = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(tekst);
  if (cdataMatch) tekst = cdataMatch[1].trim();
  return tekst
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
