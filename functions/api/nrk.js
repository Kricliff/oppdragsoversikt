// Cloudflare Pages Function - henter siste toppsaker fra NRK og TV2 sine offentlige
// RSS-feeder og returnerer dem med tittel + kildens egen logo. Brukes til å fylle
// feiringsbanneret nederst med nyheter når det ikke er noen feiringer å vise.

const KILDER = [
  { navn: "NRK", rss: "https://www.nrk.no/toppsaker.rss" },
  { navn: "TV2", rss: "https://www.tv2.no/rss/nyheter" }
];
const CACHE_SECONDS = 10 * 60;
const CACHE_VERSION = 5;
const ANTALL_SAKER = 6;

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/nrk?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await hentToppsaker();
    const response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), saker: [] }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function hentToppsaker() {
  const feeder = await Promise.all(KILDER.map(hentFraKilde));
  const alle = feeder.flat().sort((a, b) => b.publisert - a.publisert);
  return { saker: alle.slice(0, ANTALL_SAKER).map(({ tittel, logo }) => ({ tittel, logo })) };
}

async function hentFraKilde(kilde) {
  const res = await fetch(kilde.rss, { headers: { "User-Agent": "oppdragsoversikt-tavle" } });
  if (!res.ok) throw new Error(`${kilde.navn}-feed svarte ${res.status}`);
  const xml = await res.text();

  // Kildens egen logo, slik den selv publiserer den i feeden - hentes direkte fra
  // <image> i toppen av dokumentet, ikke lastet ned/kopiert av oss. TV2 sin er http -
  // tvinges til https for å unngå blandet-innhold-blokkering i nettleseren.
  const logoMatch = /<image>[\s\S]*?<url>([\s\S]*?)<\/url>[\s\S]*?<\/image>/.exec(xml);
  const logo = logoMatch ? rensXmlTekst(logoMatch[1]).replace(/^http:/, "https:") : null;

  const saker = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml))) {
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemMatch[1]);
    const tittel = titleMatch ? rensXmlTekst(titleMatch[1]) : null;
    if (!tittel) continue;
    const dateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(itemMatch[1]);
    const publisert = dateMatch ? Date.parse(dateMatch[1]) : NaN;
    saker.push({ tittel, logo, publisert: Number.isNaN(publisert) ? 0 : publisert });
  }
  return saker;
}

function rensXmlTekst(raw) {
  let tekst = raw.trim();
  const cdataMatch = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(tekst);
  if (cdataMatch) tekst = cdataMatch[1].trim();
  return tekst
    .replace(/&#(\d+);/g, (_, kode) => String.fromCodePoint(Number(kode)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, kode) => String.fromCodePoint(parseInt(kode, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
