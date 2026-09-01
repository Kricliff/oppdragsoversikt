// Cloudflare Pages Function - oppdager tre typer "feiring"-verdige hendelser og returnerer
// ALLE som fortsatt skal vises ("aktive"), ikke bare det som er nytt siden sist. Dette gjør
// at banneret overlever en sideoppdatering (F5, eller tavlens egen auto-reload ved ny
// utrulling) - klienten trenger ikke huske noe selv, den speiler bare det serveren sier.
//
// 1. Kandidat landet - jobApplication satt til "Hired" (samme kilde som "Kandidater
//    Landet"-tallet), koblet til kunde + ansvarlig via jobPostId -> jobPost.projectId ->
//    project.companyId/responsibleUserId ("Job post"-tilgang åpnet 2026-08-26).
// 2. Ny kunde - et firma har byttet til type "Customer" OG har minst ett reelt prosjekt
//    (kjent ansvarlig rådgiver). Recman eksponerer ikke selve "Tilbud signert"-øyeblikket
//    via API i det hele tatt (verken som scope eller felt) - dette er nærmeste tilgjengelige
//    signal, bekreftet ved testing før utrulling.
// 3. Nytt oppdrag - prosjektets ALLER FØRSTE faktura noensinne er opprettet (samme
//    tilnærming som "Signerte tilbud" i functions/api/tilbud.js - RecMan eksponerer ikke
//    selve "Tilbud signert"-øyeblikket, men fakturering starter aldri før det er signert,
//    bekreftet av GreatPeople selv). Byttet bort fra "ny annonse (jobPost) opprettet"
//    2026-09-01, siden en annonse kan legges ut før noe er signert i det hele tatt.
//
// Tilstanden i KV har to deler:
// - kjenteHired/kjenteKunder/kjenteSignerteOppdrag: ID-er som er sett, for å vite hva som
//   er NYTT. Hver kategori bootstrappes for seg (ikke bare ved aller første kjøring) -
//   slik at det å legge til en ny kategori senere ikke utløser feiring for alt som fantes
//   fra før (derfor et NYTT feltnavn her, ikke gjenbruk av det gamle "kjenteOppdrag" som
//   sporet jobPost-ID-er - de matcher aldri projectId-ene under, som ville feiret hele
//   den eksisterende porteføljen på én gang).
// - aktive: ferdigbygde {tekst, utloper}-poster som fortsatt skal vises, uavhengig av om
//   klienten nettopp lastet siden på nytt eller har stått åpen lenge.

const KV_KEY = "feiring-tilstand";
const CACHE_SECONDS = 5 * 60;
const CACHE_VERSION = 13;
const FEIRING_VIS_MS = 4 * 60 * 60 * 1000; // hver hendelse vises i 4 timer før den forsvinner

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/feiring?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await hentAktiveFeiringer(context.env.RECMAN_API_KEY, context.env.NOTAT_KV);
    const response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), aktive: [] }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

function feiringTekst(h) {
  if (h.type === "kunde") {
    return `🎉 ${h.navn} er ny kunde! (${h.ansvarlig}) 🎉`;
  }
  if (h.type === "oppdrag") {
    return h.kunde && h.ansvarlig
      ? `🎉 Nytt oppdrag: ${h.rolle} hos ${h.kunde}! (${h.ansvarlig}) 🎉`
      : `🎉 Nytt oppdrag: ${h.rolle}! 🎉`;
  }
  // kandidat
  return h.kunde && h.ansvarlig
    ? `🎉 Ny kandidat landet hos ${h.kunde}! (${h.ansvarlig}) 🎉`
    : "🎉 Ny kandidat landet! 🎉"; // mangler kunde/ansvarlig for enkelte eldre/eksterne søknader
}

async function hentAktiveFeiringer(apiKey, kv) {
  const [projectJson, userJson, jobPostJson, hiredJson, forsteFakturaPrProsjekt] = await Promise.all([
    hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=project&fields=name,companyId,responsibleUserId&page=1`),
    hentJson(`https://api.recman.io/v1.php?key=${apiKey}&type=json&scope=user&fields=first_name,last_name`),
    hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=jobPost&fields=title,projectId`),
    hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=jobApplication&page=1&status=hired`),
    hentForsteFakturaPrProsjekt(apiKey)
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

  // Interne nyheter skal aldri feires. To uavhengige sjekker: kundens type er
  // "ownCompany" (GreatPeople sitt eget selskap i Recman), OG - som ekstra sikkerhetsnett -
  // om ordet "GreatPeople" dukker opp i kundenavn eller annonsetittel i det hele tatt.
  // Prosjekt som ikke lar seg slå opp (f.eks. en lukket annonse) er IKKE det samme som
  // internt - de beholdes med kunde/ansvarlig = null, og faller tilbake til generisk
  // tekst hos klienten som før.
  const inneholderGreatPeople = (...tekster) =>
    tekster.some((t) => typeof t === "string" && t.toLowerCase().includes("greatpeople"));
  const erInternKunde = (project) => {
    if (!project) return false;
    const kundenavn = companyById[project.companyId]?.name;
    return companyById[project.companyId]?.type === "ownCompany" || inneholderGreatPeople(kundenavn);
  };

  // --- Nytt oppdrag: prosjektets første faktura -> project -> kunde/rolle/ansvarlig ---
  // Prosjekt som ikke lar seg slå opp (arkivert/slettet) hoppes rett og slett over her -
  // uten et prosjekt har vi verken kunde, rolle eller ansvarlig å vise uansett.
  const nyeOppdrag = Object.entries(forsteFakturaPrProsjekt)
    .map(([projectId, dato]) => ({ projectId, dato, project: projectById[projectId] }))
    .filter(({ project }) => project && !erInternKunde(project) && !inneholderGreatPeople(project.name))
    .map(({ projectId, project }) => ({
      id: String(projectId),
      rolle: project.name,
      kunde: companyById[project.companyId]?.name ?? null,
      ansvarlig: navnForUserId[String(project.responsibleUserId)] ?? null
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
    .filter(([id, c]) => c.type === "customer" && ansvarligForCompanyId[id] && !inneholderGreatPeople(c.name))
    .map(([id, c]) => ({ id, navn: c.name, ansvarlig: ansvarligForCompanyId[id] }));

  // --- Diff mot lagret tilstand for å finne det som er NYTT ---
  const tilstand = (await kv.get(KV_KEY, "json")) ?? {};

  const nyeHendelser = [];

  if (tilstand.kjenteHired) {
    const kjenteHiredSet = new Set(tilstand.kjenteHired);
    hired
      .filter((h) => !kjenteHiredSet.has(h.id))
      .forEach((h) => nyeHendelser.push({ type: "kandidat", kunde: h.kunde, ansvarlig: h.ansvarlig }));
  }

  if (tilstand.kjenteKunder) {
    const kjenteKunderSet = new Set(tilstand.kjenteKunder);
    nyeKunder
      .filter((k) => !kjenteKunderSet.has(k.id))
      .forEach((k) => nyeHendelser.push({ type: "kunde", navn: k.navn, ansvarlig: k.ansvarlig }));
  }

  if (tilstand.kjenteSignerteOppdrag) {
    const kjenteSignerteOppdragSet = new Set(tilstand.kjenteSignerteOppdrag);
    nyeOppdrag
      .filter((o) => !kjenteSignerteOppdragSet.has(o.id))
      .forEach((o) => nyeHendelser.push({ type: "oppdrag", rolle: o.rolle, kunde: o.kunde, ansvarlig: o.ansvarlig }));
  }

  // --- Bygg "aktive" - det som fortsatt var aktivt fra før (ikke utløpt) + det nye ---
  const naa = Date.now();
  const fortsattAktive = (tilstand.aktive ?? []).filter((a) => a.utloper > naa);
  const nyAktive = nyeHendelser.map((h) => ({ tekst: feiringTekst(h), utloper: naa + FEIRING_VIS_MS }));
  const aktive = [...fortsattAktive, ...nyAktive];

  // Skriv-feil (f.eks. KV sin daglige gratiskvote brukt opp) skal ikke hindre selve
  // svaret - klienten poller denne siden hvert minutt, og uten dette ville en feilet
  // skriving forhindret responsen i å bli edge-cachet i det hele tatt (se catch i
  // onRequestGet), som igjen gjør at HVERT minuttpoll treffer origin på nytt og prøver
  // (og feiler) en ny skriving - en selvforsterkende spiral rett når kvoten er brukt opp.
  try {
    await kv.put(
      KV_KEY,
      JSON.stringify({
        kjenteHired: hired.map((h) => h.id),
        kjenteKunder: nyeKunder.map((k) => k.id),
        kjenteSignerteOppdrag: nyeOppdrag.map((o) => o.id),
        aktive
      })
    );
  } catch (err) {
    console.warn("Fikk ikke skrevet feiring-tilstand til KV:", err);
  }

  return { aktive };
}

// Samme tilnærming som functions/api/tilbud.js: prosjektets aller første faktura
// noensinne brukes som stedfortreder for "tilbudet er signert", siden RecMan ikke
// eksponerer selve tilbudsstatusen via API. Returnerer { projectId: tidligsteDato }.
async function hentForsteFakturaPrProsjekt(apiKey) {
  const alleFakturaer = [];
  for (let side = 1; side <= 10; side++) {
    const url = `https://api.recman.io/v2/get/?key=${apiKey}&scope=invoice&page=${side}`;
    const json = await hentJson(url);
    if (!json?.success || !json.data) break;
    const rader = Object.values(json.data);
    if (rader.length === 0) break;
    alleFakturaer.push(...rader);
    if (rader.length < 1000) break;
  }

  const forsteFakturaPrProsjekt = {};
  alleFakturaer.forEach((r) => {
    const pid = r.projectId;
    if (!pid || !r.created) return;
    if (!forsteFakturaPrProsjekt[pid] || r.created < forsteFakturaPrProsjekt[pid]) {
      forsteFakturaPrProsjekt[pid] = r.created;
    }
  });

  return forsteFakturaPrProsjekt;
}

async function hentJson(url) {
  try {
    return await fetch(url).then((r) => r.json());
  } catch {
    return null;
  }
}
