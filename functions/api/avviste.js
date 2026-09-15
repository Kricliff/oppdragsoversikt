// Leser loggen over avviste skriveforsøk som functions/_lib/skrivevern.js bygger opp
// (skriving uten gyldig adminnøkkel, eller mot Teamskanalen uten skrivenøkkel).
// Brukes av fabrikkvisningen (/fabrikk), som lyser opp slusen når noen har forsøkt.
//
// Ingen egen cache - dette er et rent KV-oppslag, og et pågående forsøk skal synes med
// en gang. Selve loggen inneholder bevisst ingenting om hvem som forsøkte (ingen IP,
// ingen nøkkelrester) - kun rute og tidspunkt, som er det man trenger for å oppdage det.

const KV_KEY = "avviste-skrivinger";

export async function onRequestGet(context) {
  try {
    const data = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? {};
    return json({
      antall: data.antall ?? 0,
      sist: data.sist ?? null,
      forsok: data.forsok ?? []
    });
  } catch (err) {
    return json({ error: String(err), antall: 0, sist: null, forsok: [] }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
