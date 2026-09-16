// Sikkerhetssperre lagt til 2026-09-08: en tidligere forhåndsvisnings-/grendeploy
// ("automasjon", laget for Teamskanal-automatiseringen) kjørte nøyaktig samme kode som
// produksjon, men UTEN Cloudflare Access - og de fleste endepunktene stolte utelukkende
// på at Access var den eneste døren inn. Det ga i praksis åpen lese- OG skrivetilgang
// til alle som fant adressen (bekreftet med en reell testskriving, siden rettet).
//
// Denne middleware-en kjører foran ALT (alle ruter, all HTML) og stenger hver eneste
// grendeploy som ikke er selve produksjonsgrenen ("master", som Cloudflare Access
// beskytter) - MED unntak for et lite knippe ruter som en automatisert jobb faktisk
// trenger å nå uten innlogging (se UNNTATTE_RUTER under).
//
// ADMIN_SKRIVENOKKEL som header ("x-adminnokkel") gir i tillegg unntak for ALT på en
// forhåndsvisning - brukes kun til å teste endringer før de går til produksjon.
//
// UNNTATTE_RUTER er bevisst begrenset til ruter som ALLEREDE er trygge å nå uten nøkkel:
// enten har de ingen skrivehandler i det hele tatt (rene GET-oppslag), eller så beskytter
// de sin egen skriving med en egen hemmelig nøkkel uavhengig av denne sperren (teamskanal.js
// med TEAMSKANAL_SKRIVENOKKEL, agentstatus.js med AGENT_STATUS_NOKKEL). /api/skjermer er
// et bevisst UNNTAK fra unntaket - den har en skrivehandler UTEN egen nøkkelsjekk (skjermer
// skal kunne melde seg inn uten nøkkel), og er derfor kun beskyttet av nettopp denne
// grense-sperren. Legg den ALDRI til her uten samtidig å legge en ekte nøkkelsjekk i den.
//
// /api/forslag (agentmøtet) hører hjemme her etter samme regel som teamskanal og
// agentstatus: GET er et rent oppslag, og hver eneste skrivehandling krever enten
// AGENT_STATUS_NOKKEL eller ADMIN_SKRIVENOKKEL uavhengig av denne sperren. Godkjenning
// av et forslag krever i tillegg admin-nøkkelen alene - agentnøkkelen kommer ikke forbi.
const UNNTATTE_RUTER = new Set(["/api/teamskanal", "/api/endringslogg", "/api/avviste", "/api/agentstatus", "/api/kvforbruk", "/api/forslag"]);

export async function onRequest(context) {
  const branch = context.env.CF_PAGES_BRANCH;
  const erProduksjon = branch === "master";
  if (erProduksjon) return context.next();

  const url = new URL(context.request.url);
  const erUnntattRute = UNNTATTE_RUTER.has(url.pathname);

  const adminNokkel = context.env.ADMIN_SKRIVENOKKEL;
  const harAdminNokkel = !!adminNokkel && context.request.headers.get("x-adminnokkel") === adminNokkel;

  if (erUnntattRute || harAdminNokkel) return context.next();

  return new Response(
    "Denne forhåndsvisningen er stengt av sikkerhetshensyn - se master/produksjon i stedet.",
    { status: 403 }
  );
}
