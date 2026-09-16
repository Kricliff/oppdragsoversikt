// Kandidattrakten - traktall (søkt/screenet/intervjuet/ansatt osv.) fra Recman sin
// jobApplication-scope, til et nytt panel i /fabrikk sitt kommandosenter.
//
// LØST (2026-09-16): feltnavnene var opprinnelig gjettet ut fra kommentarer andre
// steder i kodebasen, og var feil på to punkter, bekreftet direkte mot et ekte svar:
// 1) scope=jobApplication støtter IKKE et fields-parameter i det hele tatt (Recman
//    svarer "invalid parameter: fields") - man får hele raden, ikke et utvalg.
// 2) scopet er PAGINERT som project-scopet i oppdrag.js (side 1 alene var bare et
//    utsnitt på 1000 rader, med et nextPage-felt som pekte videre) - i motsetning til
//    den opprinnelige antagelsen om at det kom i én enkelt side. Reelt antall er langt
//    over 1000 (13 852 ved verifiseringen), så uten paginering viste "totalt" et tall
//    13x for lavt, uten å se ut som en feil.
//
// Traktallene grupperes fortsatt helt generisk på hva Recman FAKTISK svarer med
// (r.status), i stedet for å anta bestemte stadienavn på forhånd - bekreftede verdier
// så langt: untreated, pipeline, declined, hired.
//
// Cachet i 6 TIMER (var 1 time i første versjon) - med reell paginering er dette nå
// SIDE_BATCH-vis flere Recman-kall per oppfriskning (14 sider = 14 kall), og
// jobApplication-listen endrer seg uansett ikke fort nok til å rettferdiggjøre samme
// friskhet som oppdrag.js. 6 timer holder kall/døgn på dette endepunktet nede i under
// 60, godt innenfor det som er igjen av Recman sin 200-kall/døgn-kvote ved siden av
// oppdrag.js sin egen bruk.

const CACHE_SECONDS = 6 * 60 * 60;
const MAKS_SIDER = 20; // reelt observert: 14 sider - god margin uten å risikere en løpsk løkke
const SIDE_BATCH = 5;
const SIDE_FORSOK = 3;

export async function onRequestGet(context) {
  const cache = caches.default;
  // v2: nøkkelen er bumpet for å tvinge fram en fersk oppslag - forrige nøkkel hadde
  // rukket å cache et svar med den nå rettede tomme-status-buggen ("" i stedet for
  // "ukjent") i seks timer før feilen ble oppdaget.
  const cacheKey = new Request("https://oppdragsoversikt-cache.internal/kandidater-v2");
  const cachet = await cache.match(cacheKey);
  if (cachet) return cachet;

  const apiKey = context.env.RECMAN_API_KEY;
  if (!apiKey) return json({ tilgjengelig: false, grunn: "RECMAN_API_KEY er ikke satt" });

  try {
    const rader = await hentAlleSoknader(apiKey);
    const traktall = {};
    for (const r of rader) {
      const status = String(r.status || "ukjent");
      traktall[status] = (traktall[status] ?? 0) + 1;
    }

    const resultat = { tilgjengelig: true, totalt: rader.length, traktall, hentet: Date.now() };
    const respons = json(resultat, 200, { "Cache-Control": `public, max-age=${CACHE_SECONDS}` });
    context.waitUntil(cache.put(cacheKey, respons.clone()));
    return respons;
  } catch (err) {
    return json({ tilgjengelig: false, grunn: String(err.message ?? err) }, 502);
  }
}

async function hentSideMedForsok(apiKey, side) {
  let sisteFeil = null;
  for (let forsok = 1; forsok <= SIDE_FORSOK; forsok++) {
    try {
      const url = `https://api.recman.io/v2/get/?key=${apiKey}&scope=jobApplication&page=${side}`;
      const svar = await fetch(url).then((r) => r.json());
      if (svar.success) return svar;
      sisteFeil = svar.errors ?? svar.error;
    } catch (err) {
      sisteFeil = String(err.message ?? err);
    }
    if (forsok < SIDE_FORSOK) await new Promise((r) => setTimeout(r, 300 * forsok));
  }
  throw new Error("Recman jobApplication-feil på side " + side + ": " + JSON.stringify(sisteFeil));
}

// Samme mønster som hentAlleProsjekter i oppdrag.js: hent sidene i samtidige bolker,
// stopp ved første tomme side eller når Recman ikke lenger oppgir noen nextPage.
async function hentAlleSoknader(apiKey) {
  const alle = [];
  let side = 1;

  while (side && side <= MAKS_SIDER) {
    const sideNumre = [];
    for (let s = side; s < side + SIDE_BATCH && s <= MAKS_SIDER; s++) sideNumre.push(s);

    const svar = await Promise.all(sideNumre.map((s) => hentSideMedForsok(apiKey, s)));

    let nesteSide = null;
    for (const s of svar) {
      const rader = Object.values(s.data ?? {});
      if (!rader.length) { nesteSide = null; break; }
      alle.push(...rader);
      nesteSide = s.nextPage || null;
      if (!nesteSide) break;
    }
    side = nesteSide;
  }

  return alle;
}

function json(data, status = 200, ekstra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...ekstra }
  });
}
