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
// Hver skjerm heartbeater hvert 15. sekund (se SKJERM_HEARTBEAT_MS i app.js), men et
// KV-skriv ("put") koster av en gratis kvote på kun 1000/døgn for HELE kontoen -
// uten denne bremsen bruker én eneste skjerm hele døgnkvoten i løpet av et par timer.
// En ren heartbeat (ingen faktisk endring) skrives derfor kun sjelden; selve
// gjenkjenningen av fjernstyringskommandoer skjer likevel på hvert kall, siden den kun
// leser tilstanden - AKTIV_VINDU_MS under er utvidet tilsvarende, slik at "aktiv" i
// admin fortsatt stemmer selv om sistSett kun oppdateres i lagringen med dette mellomrommet.
const HEARTBEAT_SKRIVE_MS = 10 * 60 * 1000;

// "Kontor" meldte seg inn selv (en fysisk skjerm som fortsatt heartbeater), men skal
// aldri vises i admin - fjerning derfra alene hjelper ikke siden den bare kommer tilbake
// på neste heartbeat, så den filtreres bort her i stedet.
const SKJULTE_NAVN = new Set(["Kontor"]);

export async function onRequestGet(context) {
  const alle = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? {};
  const naa = Date.now();
  // Må være god margin over HEARTBEAT_SKRIVE_MS - sistSett i lagringen kan henge opptil
  // det mellomrommet bak faktisk kontakt, siden rene heartbeats ikke skriver hver gang.
  const AKTIV_VINDU_MS = HEARTBEAT_SKRIVE_MS + 90 * 1000;

  const skjermer = Object.entries(alle)
    .filter(([, s]) => naa - s.sistSett < MAKS_ALDER_MS)
    .filter(([, s]) => !SKJULTE_NAVN.has(s.navn))
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
    // Fellesområdet er den faste skjermen og skal alltid stå i registeret.
    if (alle[id]?.navn !== "Fellesområde") {
      delete alle[id];
      await skrivTrygt(context.env.NOTAT_KV, alle);
    }
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

  // Skriv til KV med en gang ved en FAKTISK endring (nytt navn, ny gjestevisning-
  // tilstand, eller en helt ny skjerm) - ellers kun med jevne mellomrom, se
  // HEARTBEAT_SKRIVE_MS over. Svaret speiler uansett riktig tilstand hver gang, siden
  // det bygges fra samme leste `alle`-objekt.
  const noeEndret = !eksisterende || navn !== eksisterende.navn || gjestevisning !== eksisterende.gjestevisning;
  const tidForNyttSkriv = !eksisterende || naa - eksisterende.sistSett >= HEARTBEAT_SKRIVE_MS;

  if (noeEndret || tidForNyttSkriv) {
    alle[id] = { navn, sistSett, gjestevisning };
    await skrivTrygt(context.env.NOTAT_KV, alle);
  }

  return json({ gjestevisning });
}

// Om selve KV-skrivingen skulle feile (f.eks. den daglige gratiskvoten på 1000 put-
// operasjoner er brukt opp) skal ikke hele forespørselen krasje - skjermen har uansett
// fått riktig svar bygget fra det som ble LEST, den mister bare denne ene oppdateringen
// i lagringen og prøver igjen neste heartbeat.
async function skrivTrygt(kv, alle) {
  try {
    await kv.put(KV_KEY, JSON.stringify(alle));
  } catch (err) {
    console.warn("Fikk ikke skrevet skjermregisteret til KV:", err);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
