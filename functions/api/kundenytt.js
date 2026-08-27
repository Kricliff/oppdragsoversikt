// Cloudflare Pages Function - sjekker om noen av kundene (Recman company type=customer)
// er omtalt i nyhetene, via Google News' offentlige RSS-søk. Vises i et eget panel på
// tavlen (functions/api/nrk.js dekker kun store nasjonale saker og treffer sjelden noe
// om de fleste kundeselskapene).
//
// Kundelisten kan fort bli 100+ selskaper, og hvert søk er et eksternt HTTP-kall - for
// mange til å gjøre på én gang innenfor en respons. Derfor roterer vi: hvert kall sjekker
// kun en liten batch (BATCH_SIZE) videre fra der forrige kall slapp (nesteIndeks lagres i
// KV), og funnene samles opp i KV over tid til de blir for gamle (FERSKHET_DAGER) eller
// selskapet sjekkes på nytt uten treff. Med ti minutters cache og ~100+ kunder tar en full
// runde et par timer - godt nok for "har noe skjedd med en kunde nylig", ikke sanntid.

const KV_KEY = "kundenytt-tilstand";
const CACHE_SECONDS = 10 * 60;
const CACHE_VERSION = 8;
const BATCH_SIZE = 40;
const ANTALL_VIST = 3; // holdt lavt så panelet forblir kompakt og dekker minst mulig av kortene bak
const FERSKHET_DAGER = 7;
const FERSKHET_MS = FERSKHET_DAGER * 24 * 60 * 60 * 1000;

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/kundenytt?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await hentKundenytt(context.env.RECMAN_API_KEY, context.env.NOTAT_KV);
    const response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), funn: [] }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function hentKundenytt(apiKey, kv) {
  const kunder = await hentKundeliste(apiKey);
  const tilstand = (await kv.get(KV_KEY, "json")) ?? { nesteIndeks: 0, funn: {} };
  if (!tilstand.funn) tilstand.funn = {};

  if (kunder.length > 0) {
    const start = tilstand.nesteIndeks % kunder.length;
    const antall = Math.min(BATCH_SIZE, kunder.length);
    const batch = Array.from({ length: antall }, (_, i) => kunder[(start + i) % kunder.length]);

    const resultater = await Promise.all(batch.map(sokNyheterOmKunde));
    resultater.forEach((funn, i) => {
      const kundeId = batch[i].id;
      if (funn) tilstand.funn[kundeId] = funn;
      else delete tilstand.funn[kundeId];
    });

    tilstand.nesteIndeks = (start + antall) % kunder.length;
    await kv.put(KV_KEY, JSON.stringify(tilstand));
  }

  const naa = Date.now();
  const funn = Object.values(tilstand.funn)
    .filter((f) => naa - f.publisert < FERSKHET_MS)
    .sort((a, b) => b.publisert - a.publisert)
    .slice(0, ANTALL_VIST);

  return { funn };
}

async function hentKundeliste(apiKey) {
  const projectJson = await hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=project&fields=companyId&page=1`);
  const projectById = projectJson?.success ? projectJson.data : {};

  const alleCompanyIds = [...new Set(Object.values(projectById).map((p) => p.companyId).filter(Boolean))];
  if (!alleCompanyIds.length) return [];

  const companyJson = await hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=company&fields=name,type&companyIds=${alleCompanyIds.join(",")}`);
  const companyById = companyJson?.success ? companyJson.data : {};

  const inneholderGreatPeople = (t) => typeof t === "string" && t.toLowerCase().includes("greatpeople");
  return Object.entries(companyById)
    .filter(([, c]) => c.type === "customer" && c.name && !inneholderGreatPeople(c.name))
    .map(([id, c]) => ({ id, navn: c.name }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

async function sokNyheterOmKunde(kunde) {
  // Merk: q=%22...%22 (anførselstegn for eksakt frase) gir null treff hos Google News
  // sitt RSS-søk, selv for kjente selskaper - bekreftet ved testing. Uten anførselstegn
  // fungerer søket, på bekostning av litt mer upresis treffsikkerhet.
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(kunde.navn)}&hl=no&gl=NO&ceid=NO:no`;
  const xml = await hentTekst(url);
  if (!xml) return null;

  const itemMatch = /<item>([\s\S]*?)<\/item>/.exec(xml);
  if (!itemMatch) return null;

  const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemMatch[1]);
  const dateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(itemMatch[1]);
  if (!titleMatch || !dateMatch) return null;

  const publisert = Date.parse(dateMatch[1]);
  if (Number.isNaN(publisert)) return null;

  const kildeMatch = /<source[^>]*>([\s\S]*?)<\/source>/.exec(itemMatch[1]);
  const kilde = kildeMatch ? rensXmlTekst(kildeMatch[1]) : null;

  let tittel = rensXmlTekst(titleMatch[1]);
  if (kilde && tittel.endsWith(` - ${kilde}`)) {
    tittel = tittel.slice(0, tittel.length - kilde.length - 3);
  }

  return { selskap: kunde.navn, tittel, kilde, publisert };
}

async function hentTekst(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "oppdragsoversikt-tavle" } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function hentJson(url) {
  try {
    return await fetch(url).then((r) => r.json());
  } catch {
    return null;
  }
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
