// Cloudflare Pages Function - oppdager to typer "feiring"-verdige hendelser og returnerer
// dem som en engangs-hendelsesliste (hver hendelse leveres kun én gang, så klienten kan
// vise en rullende feiringsbanner uten å måtte holde styr på hva som allerede er vist).
//
// 1. Kandidat landet - jobApplication satt til "Hired" (samme kilde som "Kandidater
//    Landet"-tallet). Viser ikke kundenavn ennå - krever "Job post"-tilgang på nøkkelen
//    for å koble jobPostId til et firma, som ikke er åpnet.
// 2. Ny kunde - et firma har byttet til type "Customer" OG har minst ett reelt prosjekt
//    (kjent ansvarlig rådgiver). Recman eksponerer ikke selve "Tilbud signert"-øyeblikket
//    via API i det hele tatt (verken som scope eller felt) - dette er nærmeste tilgjengelige
//    signal, bekreftet ved testing før utrulling. Viser ansvarlig rådgiver (fra prosjektet).
//
// Tilstanden (hvilke ID-er som allerede er sett) lagres i KV. Første gang funksjonen
// kjører finnes ingen tilstand - da "bootstrappes" den stille (alt som allerede finnes
// regnes som kjent, ingen feiring utløses for eksisterende data), og bare NYE hendelser
// etter det trigger en feiring.

const KV_KEY = "feiring-tilstand";
const CACHE_SECONDS = 5 * 60;
const CACHE_VERSION = 2;

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/feiring?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await finnNyeHendelser(context.env.RECMAN_API_KEY, context.env.NOTAT_KV);
    const response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), hendelser: [] }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function finnNyeHendelser(apiKey, kv) {
  const [hiredIds, nyeKunder] = await Promise.all([
    hentHiredIds(apiKey),
    hentKvalifiserteKunder(apiKey)
  ]);

  let tilstand = await kv.get(KV_KEY, "json");
  const forsteGangKandidater = !tilstand;
  if (!tilstand) {
    tilstand = { kjenteHired: [], kjenteKunder: [] };
  }

  const kjenteHiredSet = new Set(tilstand.kjenteHired);
  const kjenteKunderSet = new Set(tilstand.kjenteKunder);

  const hendelser = [];

  if (!forsteGangKandidater) {
    hiredIds
      .filter((id) => !kjenteHiredSet.has(id))
      .forEach(() => hendelser.push({ type: "kandidat" }));

    nyeKunder
      .filter((k) => !kjenteKunderSet.has(k.id))
      .forEach((k) => hendelser.push({ type: "kunde", navn: k.navn, ansvarlig: k.ansvarlig }));
  }

  tilstand = {
    kjenteHired: hiredIds,
    kjenteKunder: nyeKunder.map((k) => k.id)
  };
  await kv.put(KV_KEY, JSON.stringify(tilstand));

  return { hendelser };
}

async function hentHiredIds(apiKey) {
  const url = `https://api.recman.io/v2/get/?key=${apiKey}&scope=jobApplication&page=1&status=hired`;
  const json = await fetch(url).then((r) => r.json());
  if (!json.success) return [];
  return json.data.map((a) => String(a.jobApplicationId));
}

async function hentKvalifiserteKunder(apiKey) {
  const projectFields = "companyId,responsibleUserId";
  const projectUrl = `https://api.recman.io/v2/get/?key=${apiKey}&scope=project&fields=${projectFields}&page=1`;
  const userUrl = `https://api.recman.io/v1.php?key=${apiKey}&type=json&scope=user&fields=first_name,last_name`;

  const [projectJson, userJson] = await Promise.all([
    fetch(projectUrl).then((r) => r.json()),
    fetch(userUrl).then((r) => r.json()).catch(() => null)
  ]);
  if (!projectJson.success) return [];

  const navnForUserId = {};
  if (userJson && !userJson.error) {
    Object.entries(userJson).forEach(([id, u]) => {
      const navn = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
      if (navn) navnForUserId[id] = navn;
    });
  }

  // Ansvarlig for feiringen = ansvarlig på det første reelle prosjektet vi finner for
  // firmaet - ved flere prosjekter/rådgivere på samme kunde plukkes bare én, ikke kritisk
  // presist for en feiringsbanner.
  const ansvarligForCompanyId = {};
  Object.values(projectJson.data).forEach((p) => {
    const ansvarlig = navnForUserId[String(p.responsibleUserId)];
    if (p.companyId && ansvarlig && !ansvarligForCompanyId[p.companyId]) {
      ansvarligForCompanyId[p.companyId] = ansvarlig;
    }
  });
  if (Object.keys(ansvarligForCompanyId).length === 0) return [];

  const idListe = Object.keys(ansvarligForCompanyId).join(",");
  const companyUrl = `https://api.recman.io/v2/get/?key=${apiKey}&scope=company&fields=name,type&companyIds=${idListe}`;
  const companyJson = await fetch(companyUrl).then((r) => r.json());
  if (!companyJson.success) return [];

  return Object.entries(companyJson.data)
    .filter(([, c]) => c.type === "customer")
    .map(([id, c]) => ({ id, navn: c.name, ansvarlig: ansvarligForCompanyId[id] }));
}
