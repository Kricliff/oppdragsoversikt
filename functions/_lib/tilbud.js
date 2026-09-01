// Delt hjelpefunksjon: RecMan eksponerer ikke tilbudsstatus (Opprettet/Sendt/Signert)
// via API uten Task-tilgang, som vi ikke har. Fakturering starter derimot aldri før et
// tilbud er signert (bekreftet av GreatPeople selv), så "prosjektets aller første
// faktura noensinne" brukes som stedfortreder for selve signeringsøyeblikket.
//
// Brukt av både functions/api/tilbud.js (tall til topplinjen + liste til admin) og
// functions/api/feiring.js (feiringsbanner ved nytt oppdrag) - ligger i _lib (ikke api)
// slik at den ikke selv blir en rute, kun et delt modul de importerer fra.

export async function hentSignerteOppdrag(apiKey) {
  const [forsteFakturaPrProsjekt, projectJson, userJson] = await Promise.all([
    hentForsteFakturaPrProsjekt(apiKey),
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
  return Object.entries(forsteFakturaPrProsjekt)
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

async function hentForsteFakturaPrProsjekt(apiKey) {
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
