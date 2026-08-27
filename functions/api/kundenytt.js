// Cloudflare Pages Function - sjekker om noen av kundene (Recman company type=customer)
// er omtalt i nyhetene, via Bing News sitt offentlige RSS-søk. Vises i et eget panel på
// tavlen (functions/api/nrk.js dekker kun store nasjonale saker og treffer sjelden noe
// om de fleste kundeselskapene).
//
// Google News' RSS-søk ble forsøkt først, men Google svarer konsekvent med 503 "Sorry..."
// (anti-bot-blokkering) på ALLE forespørsler fra Cloudflare Workers sine utgående IP-er -
// bekreftet ved feilsøking 2026-08-27, også med nettleser-aktige headere. Bing sitt
// RSS-søk fungerer fra samme miljø, men krever eksplisitte markeds-parametre
// (setmkt=nb-NO&cc=NO) for å få norske treff i det hele tatt - uten dem svarer Bing med
// en tom, engelskspråklig respons i stedet for en feil, noe som lett kan feiltolkes som
// "ingen nyheter" heller enn en lokaliseringsfeil.
//
// Kundelisten kan fort bli 100+ selskaper, og hvert søk er et eksternt HTTP-kall - for
// mange til å gjøre på én gang innenfor en respons. Derfor roterer vi: hvert kall sjekker
// kun en liten batch (BATCH_SIZE) videre fra der forrige kall slapp (nesteIndeks lagres i
// KV), og funnene samles opp i KV over tid til de blir for gamle (FERSKHET_DAGER) eller
// selskapet sjekkes på nytt uten treff. Med ti minutters cache og ~100+ kunder tar en full
// runde et par timer - godt nok for "har noe skjedd med en kunde nylig", ikke sanntid.

const KV_KEY = "kundenytt-tilstand";
const CACHE_SECONDS = 10 * 60;
const CACHE_VERSION = 25;
const BATCH_SIZE = 8;
const ANTALL_VIST = 8; // panelet viser nå kun én sak av gangen i en karusell, så flere kan samles opp
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

// Henter ALLE kunder i Recman (company type=customer), ikke bare de med et pågående
// oppdrag på tavlen akkurat nå - kundenytt skal dekke hele kundeporteføljen, inkludert
// gamle/ferdige kunder uten aktive oppdrag i dag.
async function hentKundeliste(apiKey) {
  const companyJson = await hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=company&fields=name,type&page=1`);
  const companyById = companyJson?.success ? companyJson.data : {};

  const inneholderGreatPeople = (t) => typeof t === "string" && t.toLowerCase().includes("greatpeople");
  return Object.entries(companyById)
    .filter(([, c]) => c.type === "customer" && c.name && !inneholderGreatPeople(c.name))
    .map(([id, c]) => ({ id, navn: c.name }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

async function sokNyheterOmKunde(kunde) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(kunde.navn)}&format=RSS&setmkt=nb-NO&cc=NO`;
  const xml = await hentTekst(url);
  if (!xml) return null;

  // Bing sorterer IKKE etter dato (relevans først) - så vi ser gjennom alle treffene i
  // svaret og plukker det ferskeste, i stedet for bare det første. Selskapsnavn treffer
  // ofte globale finans-nyhetsbyråer som gjenbruker samme sak på mange språk (tysk
  // "Finanznachrichten", fransk "Zonebourse" osv.) - saker som ikke er norsk/engelsk
  // filtreres bort helt, uansett hvor ferske de er.
  let ferskest = null;
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml))) {
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemMatch[1]);
    const dateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(itemMatch[1]);
    if (!titleMatch || !dateMatch) continue;

    const publisert = Date.parse(dateMatch[1]);
    if (Number.isNaN(publisert)) continue;
    if (ferskest && publisert <= ferskest.publisert) continue;

    const tittel = rensXmlTekst(titleMatch[1]);
    const kildeMatch = /<News:Source>([\s\S]*?)<\/News:Source>/.exec(itemMatch[1]);
    const kilde = kildeMatch ? rensXmlTekst(kildeMatch[1]) : null;

    if (!erTrolegNorskEllerEngelsk(tittel) || IKKE_NO_EN_KILDER.has(kilde)) continue;

    ferskest = { selskap: kunde.navn, tittel, kilde, publisert };
  }
  return ferskest;
}

// Grov språkheuristikk - ingen ordentlig språkgjenkjenning tilgjengelig i Workers-
// miljøet uten et eget API. Luker bort det tydeligste: ikke-latinske skrifttegn
// (kyrillisk, kinesisk/japansk/koreansk, arabisk) og et knippe entydige franske,
// tyske, spanske og italienske ord som ikke også finnes i norsk/engelsk. Ikke
// vanntett, men fanger opp den vanligste støyen fra globale finansnyhetsbyråer.
const IKKE_LATINSK_SKRIFT = /[Ѐ-ӿ一-鿿぀-ヿ가-힯؀-ۿ]/;
const FREMMEDSPRAK_ORD = /\b(pour|avec|dans|leur|être|nous|vous|cette|après|société|publie|résultats|trimestre|cours|actions?|bourse|chiffre|affaires|titre|und|für|nicht|auch|wird|über|durch|sowie|einem|einer|aktien|unternehmen|milliarden|millionen|del|los|las|por|para|con|una|más|della|degli|delle|perché|anche)\b/i;

// Kjente kilder som konsekvent publiserer på andre språk (globale finansnyhetsbyråer) -
// et ekstra sikkerhetsnett i tillegg til ordlisten over, siden en tittel som f.eks. bare
// er "Cours <selskapsnavn>" (Zonebourse sitt faste format) lett kan mangle ord fra listen.
const IKKE_NO_EN_KILDER = new Set(["Zonebourse", "Finanznachrichten", "AD HOC NEWS", "Boursorama", "marktscreener.com"]);

function erTrolegNorskEllerEngelsk(tekst) {
  if (IKKE_LATINSK_SKRIFT.test(tekst)) return false;
  if (FREMMEDSPRAK_ORD.test(tekst)) return false;
  return true;
}

async function hentTekst(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept-Language": "nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7"
      }
    });
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
    // Numeriske referanser (&#233; / &#xE9;) må dekodes generisk - Bing sine kilder
    // bruker mye av dette for aksenter (é, è, ø fra andre feeder osv.), og en fast
    // liste med bare navngitte enheter lot disse stå igjen som rå tekst i visningen.
    .replace(/&#(\d+);/g, (_, kode) => String.fromCodePoint(Number(kode)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, kode) => String.fromCodePoint(parseInt(kode, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
