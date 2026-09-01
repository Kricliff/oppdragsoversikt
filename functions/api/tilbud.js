// Cloudflare Pages Function - "Signerte tilbud denne måneden".
//
// RecMan eksponerer ikke tilbudsstatus (Opprettet/Sendt/Signert) via API uten
// Task-tilgang, som vi ikke har. Fakturering starter derimot (ifølge GreatPeople selv)
// aldri før et tilbud faktisk er signert - så vi bruker "prosjektets aller første
// faktura noensinne" som stedfortreder for selve signeringsøyeblikket: teller antall
// prosjekter der den datoen faller i inneværende kalendermåned.
//
// Ikke en perfekt fasit (kan ligge noen dager bak om fakturering forsinkes etter
// signering), men en pålitelig tilnærming - se samtale i git-historikken for research
// som lå til grunn.

const CACHE_SECONDS = 20 * 60;
const CACHE_VERSION = 1;

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/tilbud?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await hentSignerteTilbud(context.env.RECMAN_API_KEY);
    const response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), signerteTilbud: null }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function hentSignerteTilbud(apiKey) {
  // ~1300 fakturaer totalt i skrivende stund (2 sider) - løkker uansett til en tom side,
  // med god margin (10 sider = 10 000 fakturaer) for videre vekst.
  const alleFakturaer = [];
  for (let side = 1; side <= 10; side++) {
    const url = `https://api.recman.io/v2/get/?key=${apiKey}&scope=invoice&page=${side}`;
    const json = await fetch(url).then((r) => r.json());
    if (!json.success || !json.data) break;
    const rader = Object.values(json.data);
    if (rader.length === 0) break;
    alleFakturaer.push(...rader);
    if (rader.length < 1000) break;
  }

  const forsteFakturaPrProsjekt = {};
  alleFakturaer.forEach((r) => {
    const pid = r.projectId;
    if (!pid || !r.created) return;
    if (!forsteFakturaPrProsjekt[pid] || r.created < forsteFakturaPrProsjekt[pid]) {
      forsteFakturaPrProsjekt[pid] = r.created;
    }
  });

  const gjeldendeMaaned = new Date().toISOString().slice(0, 7);
  const signerteTilbud = Object.values(forsteFakturaPrProsjekt).filter(
    (dato) => dato.slice(0, 7) === gjeldendeMaaned
  ).length;

  return { signerteTilbud };
}
