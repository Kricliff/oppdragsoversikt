// Henter oppdrag fra vår egen Cloudflare Pages Function (/api/oppdrag), som snakker
// med Recman server-side - se functions/api/oppdrag.js. API-nøkkelen ligger som et
// Cloudflare-secret der, aldri i klientkode eller i git.
//
// Funksjonen finnes kun på Cloudflare Pages (oppdragsoversikt.pages.dev). GitHub Pages
// støtter ikke Functions, så der - og hvis noe skulle feile - faller vi automatisk
// tilbake til mock-data. app.js viser hvilken kilde som faktisk ble brukt via kildeErRecman().

let sisteKildeErRecman = false;

function kildeErRecman() {
  return sisteKildeErRecman;
}

async function hentOppdrag() {
  try {
    // no-store: uten denne kan nettleseren gjenbruke et gammelt svar fra sitt eget
    // HTTP-cache i opptil CACHE_SECONDS (functions/api/oppdrag.js) selv om AUTO_REFRESH_MS
    // trigger et nytt fetch-kall - skjermen står ubetjent i timevis, og skal alltid faktisk
    // spørre serveren på nytt, ikke stole på nettleserens egen cache-heuristikk.
    const res = await fetch("/api/oppdrag", { cache: "no-store" });
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.oppdrag)) throw new Error("Uventet svarformat fra /api/oppdrag");
    sisteKildeErRecman = true;
    return data.oppdrag;
  } catch (err) {
    console.warn("Recman-proxy ikke tilgjengelig, viser mock-data:", err);
    sisteKildeErRecman = false;
    return MOCK_OPPDRAG;
  }
}
