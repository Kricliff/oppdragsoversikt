// Register over hvilke fysiske skjermer som viser tavlen, til bruk for fjernstyring fra
// admin-siden. Cloudflare Access forteller bare HVEM som er logget inn (samme person kan
// være på flere skjermer samtidig) - ikke HVILKEN skjerm. Hver skjerm får derfor sin egen
// tilfeldige id lagret i localStorage (se hentEllerLagSkjermId i app.js) og et navn brukeren
// setter én gang, og melder seg inn her med jevne mellomrom ("heartbeat").
//
// Samme KV-lagrede objekt brukes til alt: sist sett-tidspunkt (for å vise "aktiv"/"offline"
// i admin), og ønsket tilstand (akkurat nå bare gjestevisning på/av) som skjermen selv
// speiler - samme "server eier tilstanden, klienten følger etter"-mønster som feiring.js.

const KV_KEY = "skjermer";
const MAKS_ALDER_MS = 24 * 60 * 60 * 1000; // fjernes helt fra registeret etter et døgn uten kontakt

export async function onRequestGet(context) {
  const alle = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? {};
  const naa = Date.now();
  const AKTIV_VINDU_MS = 60 * 1000; // regnes som "aktiv" om den har heartbeatet siste minutt

  const skjermer = Object.entries(alle)
    .filter(([, s]) => naa - s.sistSett < MAKS_ALDER_MS)
    .map(([id, s]) => ({
      id,
      navn: s.navn,
      sistSett: s.sistSett,
      aktiv: naa - s.sistSett < AKTIV_VINDU_MS,
      gjestevisning: !!s.gjestevisning
    }))
    .sort((a, b) => b.sistSett - a.sistSett);

  return json({ skjermer });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const id = String(body?.id ?? "").trim().slice(0, 64);
  if (!id) return json({ error: "Mangler id" }, 400);

  const alle = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? {};
  const naa = Date.now();

  // Fjerning fra admin går også via POST (samme kanal som resten) - DELETE-metoden
  // blokkeres av Cloudflares edge før den når selve funksjonen.
  if (body?.fjern === true) {
    delete alle[id];
    await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(alle));
    return json({ ok: true });
  }

  for (const [eksisterendeId, s] of Object.entries(alle)) {
    if (naa - s.sistSett > MAKS_ALDER_MS) delete alle[eksisterendeId];
  }

  const eksisterende = alle[id];
  const navn = typeof body?.navn === "string" && body.navn.trim()
    ? body.navn.trim().slice(0, 60)
    : (eksisterende?.navn ?? "Ukjent skjerm");
  const gjestevisning = typeof body?.gjestevisning === "boolean" ? body.gjestevisning : (eksisterende?.gjestevisning ?? false);
  // "heartbeat" bumper sist sett-tidspunktet - en fjernstyringskommando fra admin skal
  // IKKE gjøre det, ellers ser en skjerm som faktisk er offline falskt ut som aktiv.
  const sistSett = body?.heartbeat ? naa : (eksisterende?.sistSett ?? naa);

  alle[id] = { navn, sistSett, gjestevisning };
  await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(alle));

  return json({ gjestevisning });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
