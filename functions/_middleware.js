// Sikkerhetssperre lagt til 2026-09-08: en tidligere forhåndsvisnings-/grendeploy
// ("automasjon", laget for Teamskanal-automatiseringen) kjørte nøyaktig samme kode som
// produksjon, men UTEN Cloudflare Access - og de fleste endepunktene stolte utelukkende
// på at Access var den eneste døren inn. Det ga i praksis åpen lese- OG skrivetilgang
// til alle som fant adressen (bekreftet med en reell testskriving, siden rettet).
//
// Denne middleware-en kjører foran ALT (alle ruter, all HTML) og stenger hver eneste
// grendeploy som ikke er selve produksjonsgrenen ("master", som Cloudflare Access
// beskytter) - MED ETT unntak: /api/teamskanal, som automatiseringen faktisk trenger å
// nå uten innlogging, og som selv krever sin egen hemmelige nøkkel (TEAMSKANAL_SKRIVENOKKEL).
//
// ADMIN_SKRIVENOKKEL som header ("x-adminnokkel") gir i tillegg unntak for ALT på en
// forhåndsvisning - brukes kun til å teste endringer før de går til produksjon.
export async function onRequest(context) {
  const branch = context.env.CF_PAGES_BRANCH;
  const erProduksjon = branch === "master";
  if (erProduksjon) return context.next();

  const url = new URL(context.request.url);
  const erTeamskanalRute = url.pathname === "/api/teamskanal";

  const adminNokkel = context.env.ADMIN_SKRIVENOKKEL;
  const harAdminNokkel = !!adminNokkel && context.request.headers.get("x-adminnokkel") === adminNokkel;

  if (erTeamskanalRute || harAdminNokkel) return context.next();

  return new Response(
    "Denne forhåndsvisningen er stengt av sikkerhetshensyn - se master/produksjon i stedet.",
    { status: 403 }
  );
}
