// Cloudflare Pages Function - henter siste overskrifter fra NRKs offentlige RSS-feeder
// og returnerer dem som en enkel liste med ren tekst. Brukes til å fylle
// feiringsbanneret nederst med nyheter når det ikke er noen feiringer å vise.
//
// Bruker Norge- og Urix-seksjonene (innenriks/utenriks "hard" nyheter) i stedet for
// den generelle toppsaker.rss, som blander inn sport, livsstil og regionalt stoff -
// dette er nærmeste tilgjengelige signal for "viktige oppdateringer" via RSS.

const RSS_URLER = ["https://www.nrk.no/norge/toppsaker.rss", "https://www.nrk.no/urix/toppsaker.rss"];
const CACHE_SECONDS = 10 * 60;
const CACHE_VERSION = 2;
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
  const feeder = await Promise.all(RSS_URLER.map(hentSaker));
  const alle = feeder.flat().sort((a, b) => b.publisert - a.publisert);
  return alle.slice(0, ANTALL_SAKER).map((s) => s.tittel);
}

async function hentSaker(url) {
  const res = await fetch(url, { headers: { "User-Agent": "oppdragsoversikt-tavle" } });
  if (!res.ok) throw new Error(`NRK RSS (${url}) svarte ${res.status}`);
  const xml = await res.text();

  const saker = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml))) {
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemMatch[1]);
    const tittel = titleMatch ? rensXmlTekst(titleMatch[1]) : null;
    if (!tittel) continue;
    const dateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(itemMatch[1]);
    const publisert = dateMatch ? Date.parse(dateMatch[1]) : NaN;
    saker.push({ tittel, publisert: Number.isNaN(publisert) ? 0 : publisert });
  }
  return saker;
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
