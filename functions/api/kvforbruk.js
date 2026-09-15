// Faktisk KV-forbruk hentet fra Cloudflares egen analyse-API, til kvotemåleren i
// fabrikkvisningen (/fabrikk).
//
// Bakgrunn: siden kunne tidligere bare ANSLÅ forbruket ut fra kjente skrivemønstre, og
// anslaget bommet grovt (gjettet ~700 skrivinger i døgnet der fasiten var under 150).
// Et anslag som bommer den veien er verre enn ingenting - det ville fått noen til å
// bruke tid på et kvoteproblem som ikke finnes.
//
// Krever en Cloudflare API-token med KUN lesetilgang til kontoanalyse, lagt inn som
// Pages-hemmeligheten CF_ANALYTICS_TOKEN. Mangler den, svarer endepunktet pent at tallet
// ikke er tilgjengelig, og fabrikkvisningen faller tilbake til anslaget sitt.
//
// Døgnet følger UTC med vilje - det er slik Cloudflare selv nullstiller gratiskvoten,
// så et "døgn" etter norsk tid ville vist et annet tall enn det kvoten faktisk måles mot.

const KONTO_ID = "21ec84c15626bddf609270a7faf3d75e";
const NAVNEROM_ID = "041d970ead1042f0aabd622afebb1965";
const GRATIS_SKRIVETAK = 1000;
const CACHE_SEKUNDER = 5 * 60;

const SPORRING = `query($konto: String!, $dag: Date!, $navnerom: String!) {
  viewer {
    accounts(filter: { accountTag: $konto }) {
      kvOperationsAdaptiveGroups(limit: 50, filter: { date: $dag, namespaceId: $navnerom }) {
        sum { requests }
        dimensions { actionType }
      }
    }
  }
}`;

export async function onRequestGet(context) {
  const token = context.env.CF_ANALYTICS_TOKEN;
  if (!token) {
    return json({ tilgjengelig: false, grunn: "CF_ANALYTICS_TOKEN er ikke satt" });
  }

  const cache = caches.default;
  const dag = new Date().toISOString().slice(0, 10);
  const cacheNokkel = new Request(`https://oppdragsoversikt-cache.internal/kvforbruk?d=${dag}`);
  const cachet = await cache.match(cacheNokkel);
  if (cachet) return cachet;

  try {
    const svar = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: SPORRING, variables: { konto: KONTO_ID, dag, navnerom: NAVNEROM_ID } })
    });
    const data = await svar.json();
    if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join("; "));

    const grupper = data?.data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups ?? [];
    const tell = (type) => grupper.find((g) => g.dimensions?.actionType === type)?.sum?.requests ?? 0;

    const resultat = {
      tilgjengelig: true,
      dato: dag,
      skriv: tell("write") + tell("delete"), // sletting teller mot samme kvote som skriving
      les: tell("read"),
      liste: tell("list"),
      tak: GRATIS_SKRIVETAK
    };

    const respons = json(resultat, 200, { "Cache-Control": `public, max-age=${CACHE_SEKUNDER}` });
    context.waitUntil(cache.put(cacheNokkel, respons.clone()));
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
