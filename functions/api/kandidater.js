// Kandidattrakten - traktall (søkt/intervjuet/ansatt osv.) fra Recman sin
// jobApplication-scope, til et nytt panel i /fabrikk sitt kommandosenter.
//
// VIKTIG STATUS (2026-09-16): feltnavnene under ("status") er utledet av kommentarer
// andre steder i kodebasen (oppdrag.js/feiring.js sin bruk av candidate.pipeline), IKKE
// bekreftet mot et ekte svar fra NETTOPP dette scopet - i motsetning til resten av
// Recman-integrasjonen, som alltid har vært verifisert live før den ble stående. Gir
// dette raret eller ingenting, er feltnavn/scope sannsynligvis stedet å se først - bruk
// samme ?diagnose-mønster som oppdrag.js for å teste egne feltnavn uten å gjette blindt.
// Traktallene grupperes derfor helt generisk på hva Recman FAKTISK svarer med, i stedet
// for å anta bestemte stadienavn på forhånd.
//
// Cachet i en time - traktall trenger ikke sanntid, og dette er et helt NYTT kall som
// legges oppå det som allerede går mot Recman sin 200-kall/døgn-kvote. Ingen paginering
// (i motsetning til oppdrag.js) - dette er bevisst en første, enkel versjon; bør utvides
// med samme sidevis-henting som oppdrag.js hvis antallet søknader viser seg å sprenge én
// side.

const CACHE_SECONDS = 60 * 60;

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request("https://oppdragsoversikt-cache.internal/kandidater");
  const cachet = await cache.match(cacheKey);
  if (cachet) return cachet;

  const apiKey = context.env.RECMAN_API_KEY;
  if (!apiKey) return json({ tilgjengelig: false, grunn: "RECMAN_API_KEY er ikke satt" });

  try {
    const url = `https://api.recman.io/v2/get/?key=${apiKey}&scope=jobApplication&fields=status,projectId`;
    const svar = await fetch(url).then((r) => r.json());
    if (!svar.success) throw new Error(JSON.stringify(svar.error));

    const rader = Object.values(svar.data ?? {});
    const traktall = {};
    for (const r of rader) {
      const status = String(r.status ?? "ukjent");
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

function json(data, status = 200, ekstra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...ekstra }
  });
}
