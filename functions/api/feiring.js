// Cloudflare Pages Function - oppdager tre typer "feiring"-verdige hendelser og returnerer
// ALLE som fortsatt skal vises ("aktive"), ikke bare det som er nytt siden sist. Dette gjør
// at banneret overlever en sideoppdatering (F5, eller tavlens egen auto-reload ved ny
// utrulling) - klienten trenger ikke huske noe selv, den speiler bare det serveren sier.
//
// 1. Kandidat landet - jobApplication satt til "Hired" (samme kilde som "Kandidater
//    Landet"-tallet). Navn, kunde og ansvarlig hentes via kandidatens egen pipeline,
//    se hentKandidatDetaljer() nederst for hvorfor veien om jobPost ikke fungerer.
// 2. Ny kunde - et firma har byttet til type "Customer" OG har minst ett reelt prosjekt
//    (kjent ansvarlig rådgiver). Recman eksponerer ikke selve "Tilbud signert"-øyeblikket
//    via API i det hele tatt (verken som scope eller felt) - dette er nærmeste tilgjengelige
//    signal, bekreftet ved testing før utrulling.
// 3. Nytt oppdrag - prosjektet har fått status "Aktiv" i Recman (samme regler som avgjør
//    at et kort faktisk vises på tavlen, se _lib/oppdragStatus.js). Byttet bort fra
//    fakturabasert deteksjon 2026-09-02 - GreatPeople bekreftet at et prosjekt blir
//    reelt for rådgiverne akkurat når det dukker opp på deres egen oversikt (status
//    "Aktiv"), ikke når første faktura sendes - det kan skje lenge etter. "Signerte
//    tilbud denne mnd" (functions/api/tilbud.js) bruker fortsatt fakturadatoen, siden
//    DEN skal representere når avtalen faktisk ble signert/fakturert, ikke når arbeidet
//    ble synlig internt.
//
// Tilstanden i KV har to deler:
// - kjenteHired/kjenteKunder/kjenteAktiveOppdrag: ID-er som er sett, for å vite hva som
//   er NYTT. Hver kategori bootstrappes for seg (ikke bare ved aller første kjøring) -
//   slik at det å legge til en ny kategori senere ikke utløser feiring for alt som fantes
//   fra før (derfor et NYTT feltnavn her hver gang deteksjonsmetoden endres - matcher
//   ikke ID-ene fra forrige metode, som ville feiret hele den eksisterende porteføljen
//   på én gang).
// - aktive: ferdigbygde {tekst, utloper}-poster som fortsatt skal vises, uavhengig av om
//   klienten nettopp lastet siden på nytt eller har stått åpen lenge.

import { bestemStatus } from "../_lib/oppdragStatus.js";

const KV_KEY = "feiring-tilstand";
const CACHE_SECONDS = 5 * 60;
const CACHE_VERSION = 22;
const FEIRING_VIS_MS = 2 * 60 * 60 * 1000; // hver hendelse vises i 2 timer før den forsvinner

// En opprydding i Recman 2026-09-02 (gamle prosjekter og kunder massebehandlet) traff
// diffene under som om alt hadde skjedd akkurat da: banneret endte med 535 samtidige
// feiringer - 309 "er ny kunde" (praktisk talt hele kundebasen) og 226 "kandidat landet".
// To sperrer mot at det gjentar seg:
// - MAKS_NYE_PER_RUNDE: får én runde plutselig flere nye enn dette i en kategori, er det
//   en masseendring og ikke reelle hendelser. De registreres som kjente (så de ikke dukker
//   opp igjen senere), men feires ikke.
// - MAKS_AKTIVE: uansett årsak skal aldri mer enn dette ligge i banneret samtidig.
const MAKS_NYE_PER_RUNDE = 5;
const MAKS_AKTIVE = 12;

function massendringsvakt(nye, hva) {
  if (nye.length <= MAKS_NYE_PER_RUNDE) return nye;
  console.warn(`Hopper over feiring av ${nye.length} ${hva} pa en gang - ser ut som en masseendring i Recman, ikke reelle hendelser.`);
  return [];
}

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
  const hvem = h.navn ? `Ny kandidat landet: ${h.navn}` : "Ny kandidat landet";
  if (h.kunde && h.ansvarlig) return `🎉 ${hvem} hos ${h.kunde}! (${h.ansvarlig}) 🎉`;
  if (h.kunde) return `🎉 ${hvem} hos ${h.kunde}! 🎉`;
  return `🎉 ${hvem}! 🎉`;
}

async function hentAktiveFeiringer(apiKey, kv) {
  const [projectJson, userJson, hiredJson] = await Promise.all([
    hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=project&fields=name,companyId,responsibleUserId,status,completePercent,updated&page=1`),
    hentJson(`https://api.recman.io/v1.php?key=${apiKey}&type=json&scope=user&fields=first_name,last_name`),
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

  // Interne nyheter skal aldri feires. To uavhengige sjekker: kundens type er
  // "ownCompany" (GreatPeople sitt eget selskap i Recman), OG - som ekstra sikkerhetsnett -
  // om ordet "GreatPeople" dukker opp i kundenavnet i det hele tatt. Prosjekt som ikke
  // lar seg slå opp er IKKE det samme som internt - de beholdes, men med det vi vet.
  const inneholderGreatPeople = (...tekster) =>
    tekster.some((t) => typeof t === "string" && t.toLowerCase().includes("greatpeople"));
  const erInternKunde = (project) => {
    if (!project) return false;
    const kundenavn = companyById[project.companyId]?.name;
    return companyById[project.companyId]?.type === "ownCompany" || inneholderGreatPeople(kundenavn);
  };

  // --- Kandidat landet ---
  // Bare ID-ene her, så diffen mot KV er billig. Selve oppslaget av navn/kunde/ansvarlig
  // skjer først for de ansettelsene som faktisk er NYE (se under) - typisk 0-3 av gangen.
  const hiredRader = hiredJson?.success ? hiredJson.data : [];
  const hired = hiredRader.map((a) => ({
    id: String(a.jobApplicationId),
    candidateId: a.candidateId,
    jobPostId: a.jobPostId
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

  // --- Nytt oppdrag: status "aktiv" - SAMME kriterier som avgjør at kortet faktisk
  // vises på tavlen (bestemStatus + kundetype=customer + kjent ansvarlig), slik at
  // feiringen skjer akkurat når oppdraget dukker opp hos rådgiveren.
  const aktiveOppdrag = Object.values(projectById)
    .filter((p) => bestemStatus(p) === "aktiv")
    .filter((p) => !erInternKunde(p))
    .filter((p) => companyById[p.companyId]?.type === "customer")
    .map((p) => ({
      id: String(p.projectId),
      rolle: p.name,
      kunde: companyById[p.companyId]?.name ?? null,
      ansvarlig: navnForUserId[String(p.responsibleUserId)] ?? null
    }))
    .filter((o) => o.ansvarlig); // ukjent rådgiver = ikke synlig på tavlen, skal heller ikke feires

  // --- Diff mot lagret tilstand for å finne det som er NYTT ---
  const tilstand = (await kv.get(KV_KEY, "json")) ?? {};

  const nyeHendelser = [];

  if (tilstand.kjenteHired) {
    const kjenteHiredSet = new Set(tilstand.kjenteHired);
    const nyeAnsettelser = massendringsvakt(hired.filter((h) => !kjenteHiredSet.has(h.id)), "ansettelser");
    const detaljer = await Promise.all(
      nyeAnsettelser.map((h) => hentKandidatDetaljer(apiKey, h, projectById, companyById, navnForUserId))
    );
    detaljer
      .filter((d) => !erInternKunde(d.project))
      .forEach((d) => nyeHendelser.push({ type: "kandidat", navn: d.navn, kunde: d.kunde, ansvarlig: d.ansvarlig }));
  }

  if (tilstand.kjenteKunder) {
    const kjenteKunderSet = new Set(tilstand.kjenteKunder);
    massendringsvakt(nyeKunder.filter((k) => !kjenteKunderSet.has(k.id)), "nye kunder")
      .forEach((k) => nyeHendelser.push({ type: "kunde", navn: k.navn, ansvarlig: k.ansvarlig }));
  }

  if (tilstand.kjenteAktiveOppdrag) {
    const kjenteAktiveOppdragSet = new Set(tilstand.kjenteAktiveOppdrag);
    massendringsvakt(aktiveOppdrag.filter((o) => !kjenteAktiveOppdragSet.has(o.id)), "nye oppdrag")
      .forEach((o) => nyeHendelser.push({ type: "oppdrag", rolle: o.rolle, kunde: o.kunde, ansvarlig: o.ansvarlig }));
  }

  // --- Bygg "aktive" - det som fortsatt var aktivt fra før (ikke utløpt) + det nye ---
  const naa = Date.now();
  const fortsattAktive = (tilstand.aktive ?? []).filter((a) => a.utloper > naa);
  const nyAktive = nyeHendelser.map((h) => ({ tekst: feiringTekst(h), utloper: naa + FEIRING_VIS_MS }));
  // Siste skanse: banneret skal aldri kunne vokse seg til hundrevis av poster uansett -
  // beholder de nyeste (se MAKS_AKTIVE).
  const aktive = [...fortsattAktive, ...nyAktive].slice(-MAKS_AKTIVE);

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
        kjenteAktiveOppdrag: aktiveOppdrag.map((o) => o.id),
        aktive
      })
    );
  } catch (err) {
    console.warn("Fikk ikke skrevet feiring-tilstand til KV:", err);
  }

  return { aktive };
}

// Finner navn, kunde og ansvarlig for EN ny ansettelse.
//
// Den opprinnelige veien var jobApplication -> jobPost -> project, men scope=jobPost
// returnerer KUN aktive annonser ("Retrieve a list of all active job posts" i RecMan-
// dokumentasjonen), og en ansettelse skjer typisk etter at annonsen er tatt ned. Målt
// mot ekte data løste 0 av 113 ansettelser seg opp - inkludert den nyeste - så banneret
// endte ALLTID på den generiske teksten uten navn, kunde og rådgiver (2026-09-02).
//
// Veien går nå via kandidatens egen pipeline i candidate-scopet, som har både projectId,
// jobPostId og userId - og navnet ligger i samme oppslag.
async function hentKandidatDetaljer(apiKey, ansettelse, projectById, companyById, navnForUserId) {
  const tomt = { navn: null, kunde: null, ansvarlig: null, project: null };
  if (!ansettelse.candidateId) return tomt;

  const json = await hentJson(
    `https://api.recman.io/v2/get/?key=${apiKey}&scope=candidate&candidateId=${ansettelse.candidateId}&fields=firstName,lastName,pipeline`
  );
  const rad = json?.success ? Object.values(json.data ?? {})[0] : null;
  if (!rad) return tomt;

  // En kandidat kan ligge i flere prosjekt-pipelines - velg den som hører til annonsen
  // det ble ansatt på, ellers den sist oppdaterte som har et prosjekt på seg.
  const pipeline = Array.isArray(rad.pipeline) ? rad.pipeline.filter((p) => p.projectId) : [];
  const treff =
    pipeline.find((p) => String(p.jobPostId) === String(ansettelse.jobPostId)) ??
    [...pipeline].sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0];

  const project = treff ? projectById[treff.projectId] : null;
  return {
    navn: `${rad.firstName ?? ""} ${rad.lastName ?? ""}`.trim() || null,
    kunde: project ? companyById[project.companyId]?.name ?? null : null,
    // Faller tilbake til den som eier pipeline-oppføringen hvis prosjektet ikke lar seg slå opp
    ansvarlig:
      (project ? navnForUserId[String(project.responsibleUserId)] : null) ??
      (treff ? navnForUserId[String(treff.userId)] : null) ??
      null,
    project
  };
}

async function hentJson(url) {
  try {
    return await fetch(url).then((r) => r.json());
  } catch {
    return null;
  }
}
