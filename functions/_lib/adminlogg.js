// Delt hjelpefunksjon for et lett aktivitetsspor på admin-siden - hvem gjorde hva, når.
// Identiteten kommer gratis fra Cloudflare Access (samme innlogging som resten av
// /admin), via headeren Cf-Access-Authenticated-User-Email - ingen egen
// bruker-håndtering nødvendig. Filen ligger i _lib (ikke api) slik at den ikke selv
// blir en rute - kun et delt modul de andre funksjonene importerer fra.

const KV_KEY = "admin-aktivitetslogg";
const MAKS_ALDER_MS = 30 * 24 * 60 * 60 * 1000; // behold 30 dager
const MAKS_ANTALL = 200;

export async function loggAdminHandling(kv, request, handling) {
  try {
    const epost = request.headers.get("Cf-Access-Authenticated-User-Email") ?? "ukjent";
    const naa = Date.now();
    const tilstand = (await kv.get(KV_KEY, "json")) ?? { hendelser: [] };
    const grense = naa - MAKS_ALDER_MS;
    const hendelser = [
      { tidspunkt: naa, epost, handling },
      ...tilstand.hendelser.filter((h) => h.tidspunkt > grense)
    ].slice(0, MAKS_ANTALL);

    await kv.put(KV_KEY, JSON.stringify({ hendelser }));
  } catch (err) {
    // Aktivitetsloggen er kun til informasjon - skal aldri kunne ødelegge selve
    // handlingen den logger (f.eks. om KV sin skrivekvote skulle være brukt opp).
    console.warn("Fikk ikke logget admin-handling:", err);
  }
}
