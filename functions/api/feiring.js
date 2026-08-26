// Cloudflare Pages Function - oppdager to typer "feiring"-verdige hendelser og returnerer
// dem som en engangs-hendelsesliste (hver hendelse leveres kun én gang, så klienten kan
// vise en rullende feiringsbanner uten å måtte holde styr på hva som allerede er vist).
//
// 1. Kandidat landet - jobApplication satt til "Hired" (samme kilde som "Kandidater
//    Landet"-tallet), koblet til kunde + ansvarlig via jobPostId -> jobPost.projectId ->
//    project.companyId/responsibleUserId ("Job post"-tilgang åpnet 2026-08-26).
// 2. Ny kunde - et firma har byttet til type "Customer" OG har minst ett reelt prosjekt
//    (kjent ansvarlig rådgiver). Recman eksponerer ikke selve "Tilbud signert"-øyeblikket
//    via API i det hele tatt (verken som scope eller felt) - dette er nærmeste tilgjengelige
//    signal, bekreftet ved testing før utrulling.
// 3. Nytt oppdrag - en ny annonse (jobPost) er opprettet i Recman, koblet til kunde +
//    ansvarlig via samme project-oppslag som over.
//
// Tilstanden (hvilke ID-er som allerede er sett) lagres i KV. Første gang funksjonen
// kjører finnes ingen tilstand - da "bootstrappes" den stille (alt som allerede finnes
// regnes som kjent, ingen feiring utløses for eksisterende data), og bare NYE hendelser
// etter det trigger en feiring.

const KV_KEY = "feiring-tilstand";
const CACHE_SECONDS = 5 * 60;
const CACHE_VERSION = 6;

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
  const [projectJson, userJson, jobPostJson, hiredJson] = await Promise.all([
    hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=project&fields=companyId,responsibleUserId&page=1`),
    hentJson(`https://api.recman.io/v1.php?key=${apiKey}&type=json&scope=user&fields=first_name,last_name`),
    hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=jobPost&fields=title,projectId`),
    hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=jobApplication&page=1&status=hired`)
  ]);

  const navnForUserId = {};
  if (userJson && !userJson.error) {
    Object.entries(userJson).forEach(([id, u]) => {
      const navn = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
      if (navn) navnForUserId[id] = navn;
    });
  }

  const projectById = projectJson?.success ? projectJson.data : {};

  const alleCompanyIds = [...new Set(Object.values(projectById).map((p) => p.companyId).filter(Boolean))];
  const companyJson = alleCompanyIds.length
    ? await hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=company&fields=name,type&companyIds=${alleCompanyIds.join(",")}`)
    : null;
  const companyById = companyJson?.success ? companyJson.data : {};

  const projectIdForJobPostId = {};
  const jobPostRader = jobPostJson?.success ? Object.values(jobPostJson.data) : [];
  jobPostRader.forEach((jp) => {
    projectIdForJobPostId[jp.jobPostId] = jp.projectId;
  });

  // GreatPeople sitt eget selskap (type "ownCompany") - interne oppdrag/ansettelser skal
  // ikke feires som om det var en ekstern kunde. Prosjekt som ikke lar seg slå opp i det
  // hele tatt (f.eks. en lukket annonse) er IKKE det samme som internt - de beholdes med
  // kunde/ansvarlig = null, og faller tilbake til generisk tekst hos klienten som før.
  const erInternKunde = (project) => Boolean(project) && companyById[project.companyId]?.type === "ownCompany";

  // --- Nytt oppdrag: annonse (jobPost) -> project -> kunde/ansvarlig ---
  const nyeOppdrag = jobPostRader
    .map((jp) => ({ jp, project: jp.projectId ? projectById[jp.projectId] : null }))
    .filter(({ project }) => !erInternKunde(project))
    .map(({ jp, project }) => ({
      id: String(jp.jobPostId),
      tittel: jp.title,
      kunde: project ? companyById[project.companyId]?.name : null,
      ansvarlig: project ? navnForUserId[String(project.responsibleUserId)] : null
    }));

  // --- Kandidat landet: jobApplication -> jobPost -> project -> kunde/ansvarlig ---
  const hiredRader = hiredJson?.success ? hiredJson.data : [];
  const hired = hiredRader
    .map((a) => ({ a, project: projectIdForJobPostId[a.jobPostId] ? projectById[projectIdForJobPostId[a.jobPostId]] : null }))
    .filter(({ project }) => !erInternKunde(project))
    .map(({ a, project }) => ({
      id: String(a.jobApplicationId),
      kunde: project ? companyById[project.companyId]?.name : null,
      ansvarlig: project ? navnForUserId[String(project.responsibleUserId)] : null
    }));

  // --- Ny kunde: type=customer OG minst ett reelt prosjekt (kjent ansvarlig) ---
  const ansvarligForCompanyId = {};
  Object.values(projectById).forEach((p) => {
    const ansvarlig = navnForUserId[String(p.responsibleUserId)];
    if (p.companyId && ansvarlig && !ansvarligForCompanyId[p.companyId]) {
      ansvarligForCompanyId[p.companyId] = ansvarlig;
    }
  });
  const nyeKunder = Object.entries(companyById)
    .filter(([id, c]) => c.type === "customer" && ansvarligForCompanyId[id])
    .map(([id, c]) => ({ id, navn: c.name, ansvarlig: ansvarligForCompanyId[id] }));

  // --- Diff mot lagret tilstand ---
  // Hver kategori bootstrappes for seg (ikke bare ved aller første kjøring) - slik at det
  // å legge til en NY kategori senere (som "kjenteOppdrag" ble) ikke utløser en feiring for
  // alt som allerede fantes fra før, bare fordi den kategorien selv er tom første gang.
  const tilstand = (await kv.get(KV_KEY, "json")) ?? {};

  const hendelser = [];

  if (tilstand.kjenteHired) {
    const kjenteHiredSet = new Set(tilstand.kjenteHired);
    hired
      .filter((h) => !kjenteHiredSet.has(h.id))
      .forEach((h) => hendelser.push({ type: "kandidat", kunde: h.kunde, ansvarlig: h.ansvarlig }));
  }

  if (tilstand.kjenteKunder) {
    const kjenteKunderSet = new Set(tilstand.kjenteKunder);
    nyeKunder
      .filter((k) => !kjenteKunderSet.has(k.id))
      .forEach((k) => hendelser.push({ type: "kunde", navn: k.navn, ansvarlig: k.ansvarlig }));
  }

  if (tilstand.kjenteOppdrag) {
    const kjenteOppdragSet = new Set(tilstand.kjenteOppdrag);
    nyeOppdrag
      .filter((o) => !kjenteOppdragSet.has(o.id))
      .forEach((o) => hendelser.push({ type: "oppdrag", tittel: o.tittel, kunde: o.kunde, ansvarlig: o.ansvarlig }));
  }

  await kv.put(
    KV_KEY,
    JSON.stringify({
      kjenteHired: hired.map((h) => h.id),
      kjenteKunder: nyeKunder.map((k) => k.id),
      kjenteOppdrag: nyeOppdrag.map((o) => o.id)
    })
  );

  return { hendelser };
}

async function hentJson(url) {
  try {
    return await fetch(url).then((r) => r.json());
  } catch {
    return null;
  }
}
