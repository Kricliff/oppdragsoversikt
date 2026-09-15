// Delt skrivebeskyttelse for admin sine endepunkter (post-it, bilde-oppslag, bursdager,
// innstillinger, parkerte oppdrag, fjernstyring). Disse har historisk stolt UTELUKKENDE
// på at Cloudflare Access beskytter hoveddomenet - men enhver forhåndsvisnings-/
// grendeploy (f.eks. den vi bruker for Teamskanal-automatiseringen) kjører nøyaktig
// samme kode UTEN Access, og hadde dermed helt åpen skrivetilgang for hvem som helst
// som fant adressen. Bekreftet med en reell (og siden rettet) testskriving 2026-09-08.
//
// admin/index.html sender nøkkelen med på hvert skrivekall - se ADMIN_NOKKEL der.
// _middleware.js gir i tillegg samme nøkkel unntak fra grense-sperren på ikke-produksjon,
// slik at vi fortsatt kan teste skriving på en forhåndsvisning.
export function harGyldigAdminNokkel(context) {
  const nokkel = context.env.ADMIN_SKRIVENOKKEL;
  if (!nokkel) return false; // ingen nøkkel satt = ingen skriving, aldri åpent som standard
  return context.request.headers.get("x-adminnokkel") === nokkel;
}

// Avviste skriveforsøk forsvant tidligere i stillhet - et forsøk på å skrive uten gyldig
// nøkkel er nettopp det man ØNSKER å få vite om, så det er verdt å ta vare på. Loggen
// leses av /api/avviste og lyser opp slusen i fabrikkvisningen (/fabrikk).
//
// Kall alltid via context.waitUntil, slik at selve avvisningen svares med en gang og
// aldri venter på en KV-skriving.
const AVVISTE_KV_KEY = "avviste-skrivinger";
const SKRIVE_PAUSE_MS = 60 * 1000;
const MAKS_FORSOK = 20;

export async function loggAvvistSkriving(context, rute) {
  const kv = context.env.NOTAT_KV;
  if (!kv) return;

  try {
    const naa = Date.now();
    const data = (await kv.get(AVVISTE_KV_KEY, "json")) ?? {};
    const sistSkrevet = data.sistSkrevet ?? 0;

    // Et avvist forsøk kan utløses fritt av hvem som helst utenfra. Uten denne bremsen
    // kunne noen brent hele døgnets KV-skrivekvote ved å hamre på et skriveendepunkt,
    // og dermed slått ut lagringen for HELE tavlen. Prisen er at antallet blir omtrentlig
    // under et pågående kjør - derfor vises det som "minst N" i fabrikkvisningen. Selve
    // sist-tidspunktet er likevel ferskt nok til å se at noe pågår akkurat nå.
    if (naa - sistSkrevet < SKRIVE_PAUSE_MS) return;

    await kv.put(
      AVVISTE_KV_KEY,
      JSON.stringify({
        antall: (data.antall ?? 0) + 1,
        sist: naa,
        sistSkrevet: naa,
        forsok: [{ tidspunkt: naa, rute }, ...(data.forsok ?? [])].slice(0, MAKS_FORSOK)
      })
    );
  } catch (err) {
    // Skal aldri velte selve avvisningen - den er viktigere enn loggføringen av den.
    console.warn("Fikk ikke loggført avvist skriving:", err);
  }
}

export function ikkeGodkjentSvar(context, rute) {
  if (context && rute) context.waitUntil(loggAvvistSkriving(context, rute));
  return new Response(JSON.stringify({ error: "Mangler eller feil adminnøkkel" }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}
