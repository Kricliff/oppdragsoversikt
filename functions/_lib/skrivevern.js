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

export function ikkeGodkjentSvar() {
  return new Response(JSON.stringify({ error: "Mangler eller feil adminnøkkel" }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}
