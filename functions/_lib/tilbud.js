// Delt hjelpefunksjon: RecMan eksponerer ikke tilbudsstatus (Opprettet/Sendt/Signert)
// via API uten Task-tilgang, som vi ikke har. Fakturering starter derimot aldri før et
// tilbud er signert (bekreftet av GreatPeople selv), så "prosjektets OPPSTART-faktura"
// (den første av tre faser - oppstart/presentasjon/avslutning) brukes som stedfortreder
// for selve signeringsøyeblikket. Samme resonnement brukes motsatt vei for avslutning:
// prosjektets SISTE avslutningsfaktura brukes som stedfortreder for at oppdraget er
// ferdig levert til kunden.
//
// Viktig presisering (2026-09-01): den kronologisk FØRSTE fakturaen på et prosjekt er
// ikke alltid oppstartsfakturaen - annonsekostnader blir ofte fakturert separat, og i
// 99 av 411 prosjekter var det faktisk den aller første fakturaen. Vi klassifiserer
// derfor hver faktura ut fra fakturalinjenes beskrivelse, og bruker den tidligste blant
// dem som faktisk ser ut som en oppstartsfaktura - ikke bare den tidligste totalt.
//
// Brukt av både functions/api/tilbud.js (signerte tilbud - tall til topplinjen + liste
// til admin), functions/api/avsluttet.js (avsluttede oppdrag - tall til topplinjen) og
// functions/api/feiring.js (feiringsbanner ved nytt oppdrag) - ligger i _lib (ikke api)
// slik at den ikke selv blir en rute, kun et delt modul de importerer fra.

export async function hentSignerteOppdrag(apiKey) {
  const fakturaDatoPrProsjekt = await hentForsteFakturaPrProsjekt(apiKey);
  return byggOppdragsliste(apiKey, fakturaDatoPrProsjekt);
}

export async function hentAvsluttedeOppdrag(apiKey) {
  const fakturaDatoPrProsjekt = await hentSisteAvslutningPrProsjekt(apiKey);
  return byggOppdragsliste(apiKey, fakturaDatoPrProsjekt);
}

async function byggOppdragsliste(apiKey, fakturaDatoPrProsjekt) {
  const [projectJson, userJson] = await Promise.all([
    hentJson(`https://api.recman.io/v2/get/?key=${apiKey}&scope=project&fields=name,companyId,responsibleUserId&page=1`),
    hentJson(`https://api.recman.io/v1.php?key=${apiKey}&type=json&scope=user&fields=first_name,last_name`)
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

  const inneholderGreatPeople = (t) => typeof t === "string" && t.toLowerCase().includes("greatpeople");
  const erInternKunde = (project) => {
    if (!project) return false;
    return companyById[project.companyId]?.type === "ownCompany" || inneholderGreatPeople(companyById[project.companyId]?.name);
  };

  // Prosjekt som ikke lar seg slå opp (arkivert/slettet) hoppes over - uten et prosjekt
  // har vi verken kunde, rolle eller ansvarlig å vise uansett.
  return Object.entries(fakturaDatoPrProsjekt)
    .map(([projectId, dato]) => ({ projectId, dato, project: projectById[projectId] }))
    .filter(({ project }) => project && !erInternKunde(project) && !inneholderGreatPeople(project.name))
    .map(({ projectId, dato, project }) => ({
      id: String(projectId),
      rolle: project.name,
      kunde: companyById[project.companyId]?.name ?? null,
      ansvarlig: navnForUserId[String(project.responsibleUserId)] ?? null,
      dato
    }));
}

// Eksplisitt oppstart/fase 1-markør ("oppstart", "oppstartshonorar", "del 1", "1 av 3",
// "1/3" osv.) - finnes denne på EN linje, regnes fakturaen som oppstart uansett hva de
// andre linjene på samme faktura måtte inneholde (noen prosjekter fakturerer alle tre
// faser samlet i én faktura - se ekte eksempel med "Oppstartshonorar" + "Del 2..." +
// "Del 3..." på samme faktura).
const OPPSTART_MONSTER = /\boppstart\w*\b|\bdel\s*1\b|\b1\s*(av|of)\s*[23]\b|1\/[23]/i;

// Fase 2-markør ("del 2", "2 av 3", "presentasjon" osv.) - diskvalifiserer en faktura
// FRA oppstart, med mindre den også har en eksplisitt oppstart-linje (høyere prioritet).
const PRESENTASJON_MONSTER = /\bdel\s*2\b|\b2\s*(av|of)\s*3\b|2\/3|\bpresentasjon\w*\b/i;

// Fase 3/avslutnings-markør - brukt BÅDE til å diskvalifisere en faktura fra oppstart, OG
// (motsatt fortegn, se erAvslutningFaktura) til å plukke ut selve avslutningsfakturaen.
// Dekker to ulike måter GreatPeople faktisk skriver den siste fasen på (bekreftet av
// GreatPeople 2026-09-01): eksplisitt fasenummer ("del 3", "3 av 3", "sluttfaktura",
// "avslutning") OG kandidatspråk ("signert/signering Kandidat", "Landet Kandidat") -
// de to brukes om hverandre og fanges derfor begge opp, med rom for variasjoner i endelser.
const AVSLUTNING_MONSTER =
  /\bdel\s*3\b|\b3\s*(av|of)\s*3\b|3\/3|\bavslutning\w*\b|\bsluttfaktura\w*\b|\bsigner\w*\s+kandidat\w*|\bkandidat\w*\s+signer\w*|\blandet\s+kandidat\w*|\bkandidat\w*\s+landet\w*/i;

// Rene kostnadslinjer (annonsering, administrasjon, reise) - fakturert uavhengig av
// hvilken fase oppdraget faktisk er i, og skal ikke alene utløse "signert"-status.
const KUN_KOSTNAD_MONSTER = /annonsekostnad|administrasjonskostnad|reisekostnad|m[åa]lrettet annonsering|iht\.?\s*mediaplan/i;

function erOppstartFaktura(rad) {
  const linjer = Object.values(rad.lines ?? {}).map((l) => l.description ?? "");
  if (linjer.length === 0) return false;
  if (linjer.some((b) => OPPSTART_MONSTER.test(b))) return true;
  if (linjer.some((b) => PRESENTASJON_MONSTER.test(b) || AVSLUTNING_MONSTER.test(b))) return false;
  if (linjer.every((b) => KUN_KOSTNAD_MONSTER.test(b))) return false;
  return true;
}

// Strengere enn erOppstartFaktura med hensikt: en faktura uten NOEN fasemarkør defaultes
// IKKE til å være avslutning (i motsetning til oppstart, som defaultes til true - se
// begrunnelse i filens toppkommentar). Uten dette ville ethvert prosjekt sin siste
// registrerte faktura - uansett årsak - blitt tolket som at oppdraget var ferdig levert.
function erAvslutningFaktura(rad) {
  const linjer = Object.values(rad.lines ?? {}).map((l) => l.description ?? "");
  return linjer.some((b) => AVSLUTNING_MONSTER.test(b));
}

async function hentForsteFakturaPrProsjekt(apiKey) {
  const alleFakturaer = await hentAlleFakturaer(apiKey);

  const forsteFakturaPrProsjekt = {};
  alleFakturaer.forEach((r) => {
    const pid = r.projectId;
    if (!pid || !r.created || !erOppstartFaktura(r)) return;
    if (!forsteFakturaPrProsjekt[pid] || r.created < forsteFakturaPrProsjekt[pid]) {
      forsteFakturaPrProsjekt[pid] = r.created;
    }
  });

  return forsteFakturaPrProsjekt;
}

async function hentSisteAvslutningPrProsjekt(apiKey) {
  const alleFakturaer = await hentAlleFakturaer(apiKey);

  const sisteAvslutningPrProsjekt = {};
  alleFakturaer.forEach((r) => {
    const pid = r.projectId;
    if (!pid || !r.created || !erAvslutningFaktura(r)) return;
    if (!sisteAvslutningPrProsjekt[pid] || r.created > sisteAvslutningPrProsjekt[pid]) {
      sisteAvslutningPrProsjekt[pid] = r.created;
    }
  });

  return sisteAvslutningPrProsjekt;
}

async function hentAlleFakturaer(apiKey) {
  // ~1300 fakturaer totalt i skrivende stund (2 sider) - løkker uansett til en tom side,
  // med god margin (10 sider = 10 000 fakturaer) for videre vekst.
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
  return alleFakturaer;
}

async function hentJson(url) {
  try {
    return await fetch(url).then((r) => r.json());
  } catch {
    return null;
  }
}
