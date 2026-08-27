// Henter oppdrag fra vår egen Cloudflare Pages Function (/api/oppdrag), som snakker
// med Recman server-side - se functions/api/oppdrag.js. API-nøkkelen ligger som et
// Cloudflare-secret der, aldri i klientkode eller i git.
//
// Funksjonen finnes kun på Cloudflare Pages (oppdragsoversikt.pages.dev). GitHub Pages
// støtter ikke Functions, så der - og hvis noe skulle feile - faller vi automatisk
// tilbake til mock-data. app.js viser hvilken kilde som faktisk ble brukt via kildeErRecman().

let sisteKildeErRecman = false;
let sisteKandidaterLandetIAr = null;

function kildeErRecman() {
  return sisteKildeErRecman;
}

// Ekte antall kandidater "hired" i år (fra Recman sin jobApplication-scope) - null hvis
// vi kjører på mock-data eller oppslaget skulle feile. app.js faller da tilbake til en
// egen tilnærming i stedet for å vise et manglende tall (se renderStats i app.js).
function kandidaterLandetIArEkte() {
  return sisteKandidaterLandetIAr;
}

async function hentOppdrag() {
  try {
    const res = await fetch("/api/oppdrag");
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.oppdrag)) throw new Error("Uventet svarformat fra /api/oppdrag");
    sisteKildeErRecman = true;
    sisteKandidaterLandetIAr = typeof data.kandidaterLandetIAr === "number" ? data.kandidaterLandetIAr : null;
    return data.oppdrag;
  } catch (err) {
    console.warn("Recman-proxy ikke tilgjengelig, viser mock-data:", err);
    sisteKildeErRecman = false;
    sisteKandidaterLandetIAr = null;
    return MOCK_OPPDRAG;
  }
}
