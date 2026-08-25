// Cloudflare Pages Function - server-side proxy mot Recman.
// Kjører kun på Cloudflare Pages (ikke GitHub Pages, som ikke støtter Functions -
// der faller recman-adapter.js automatisk tilbake til mock-data).
//
// RECMAN_API_KEY leses fra et Cloudflare-secret (satt med `wrangler pages secret put`).
// Nøkkelen er ALDRI i kode eller i git.
//
// Recman har et tak på 200 kall/dag. Vi gjør 3 kall per oppfriskning (project/user/company)
// og cacher svaret CACHE_SECONDS på Cloudflares edge, så gjentatte sideinnlastinger fra
// skjermen ikke bruker opp kvoten.

const CACHE_SECONDS = 20 * 60;
// Bump denne når normaliseringslogikken under endres, slik at gamle cachede svar fra
// før endringen ikke fortsetter å bli servert i opptil CACHE_SECONDS etter en deploy.
const CACHE_VERSION = 5;

// EKSPERIMENT (2026-08-25): mange rådgivere glemmer å sette prosjektstatus til "Løst"
// når de er ferdige, men husker som regel å sette fremdrift til 100%. Til det motsatte
// er bevist, behandler vi 100% fremdrift som utført uansett hva statusfeltet sier -
// men aldri for cancelled/lost, som er en bevisst avsluttet-uten-suksess-tilstand.
const BEHANDLE_100_PROSENT_SOM_UTFORT = true;

// Recman inneholder mange gamle prosjekter som ble satt til "active"/"urgent" og aldri
// lukket - reelt sett forlatte, ikke faktisk aktivt arbeid. Et "aktiv"-oppdrag som ikke
// er rørt i Recman på lenger enn dette regnes ikke som aktivt lenger, og skjules.
const AKTIV_MAKS_DAGER_UTEN_OPPDATERING = 90;

// Recman sine prosjekt-statuser (se help.recman.io "Projects module") normalisert til
// det tavlen forstår. "cancelled" og "lost" er bevisst utelatt - de skal ikke vises,
// og alt som ikke er "aktiv"/"utfort" skjules automatisk av erSynligPaTavle i app.js.
const STATUS_MAP = {
  request: "aktiv",
  notStarted: "aktiv",
  active: "aktiv",
  urgent: "aktiv",
  solvedEnded: "utfort",
  solvedOngoing: "utfort"
};

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/oppdrag?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const oppdrag = await hentOgNormaliser(context.env.RECMAN_API_KEY);
    const response = new Response(JSON.stringify(oppdrag), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function hentOgNormaliser(apiKey) {
  if (!apiKey) throw new Error("RECMAN_API_KEY er ikke satt");

  const projectFields = "name,status,completePercent,companyId,responsibleUserId,updated,members";
  const projectUrl = `https://api.recman.io/v2/get/?key=${apiKey}&scope=project&fields=${projectFields}&page=1`;
  const userUrl = `https://api.recman.io/v1.php?key=${apiKey}&type=json&scope=user&fields=first_name,last_name`;

  const [projectJson, userJson] = await Promise.all([
    fetch(projectUrl).then((r) => r.json()),
    fetch(userUrl).then((r) => r.json()).catch(() => null)
  ]);

  if (!projectJson.success) {
    throw new Error("Recman project-feil: " + JSON.stringify(projectJson.error));
  }

  // Rådgivernavn - "user"-scope. Slår aldri hele svaret i stykker om dette skulle feile.
  const radgiverNavn = {};
  if (userJson && !userJson.error) {
    for (const [id, u] of Object.entries(userJson)) {
      const navn = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
      if (navn) radgiverNavn[id] = navn;
    }
  }

  // Kundenavn + kundetype - "company"-scope. Recman har over 1000 kunder totalt
  // (paginert), så i stedet for å bla gjennom alle henter vi bare de companyId-ene som
  // faktisk er i bruk på prosjektene våre, via companyIds-filteret (samme mønster som
  // projectIds). Faller tilbake til "Kunde #<id>" for enkelt-oppslag som skulle feile.
  const kundeNavn = {};
  const kundeType = {};
  let kundedataLastetOk = false;
  const brukteCompanyIds = [...new Set(Object.values(projectJson.data).map((p) => p.companyId).filter(Boolean))];
  if (brukteCompanyIds.length > 0) {
    try {
      const companyUrl = `https://api.recman.io/v2/get/?key=${apiKey}&scope=company&fields=name,type&companyIds=${brukteCompanyIds.join(",")}`;
      const companyJson = await fetch(companyUrl).then((r) => r.json());
      if (companyJson.success) {
        kundedataLastetOk = true;
        for (const [id, c] of Object.entries(companyJson.data ?? {})) {
          if (c.name) kundeNavn[id] = c.name;
          if (c.type) kundeType[id] = c.type;
        }
      }
    } catch {
      // kundeNavn/kundeType forblir tomme - "Kunde #<id>" brukes under, og
      // kunde-type-filteret slås av (se erIkkeEkteKunde) siden vi ikke fikk data.
    }
  }

  return Object.values(projectJson.data)
    .map((p) => {
      let status = STATUS_MAP[p.status];
      if (!status) return null; // cancelled/lost - skjules

      if (BEHANDLE_100_PROSENT_SOM_UTFORT && status === "aktiv" && Number(p.completePercent) >= 100) {
        status = "utfort";
      }

      if (status === "aktiv" && erForGammelTilAVaereAktiv(p.updated)) return null;
      // Recman-kunder er typet (customer/prospect/ownCompany/formerCustomer/osv). Prosjekter
      // knyttet til f.eks. et "prospect" er salgsoppfølging, ikke et reelt kundeoppdrag -
      // luk dem bort så tavlen bare viser arbeid for faktiske kunder. Slår aldri filteret på
      // hvis kundedata ikke lot seg hente (kundedataLastetOk === false) - da vises alt,
      // heller enn å risikere å skjule ekte oppdrag pga. en API-feil.
      if (kundedataLastetOk && kundeType[p.companyId] && kundeType[p.companyId] !== "customer") return null;

      return {
        id: "recman-" + p.projectId,
        tittel: p.name,
        kunde: kundeNavn[p.companyId] ?? `Kunde #${p.companyId}`,
        ansvarlig: radgiverNavn[p.responsibleUserId] ?? "Ukjent rådgiver",
        status,
        // Recman har ikke et felt for kandidater-i-prosess på selve prosjektet - dette er
        // antall personer registrert som medlemmer på prosjektet, ikke kandidater i pipeline.
        antallKandidater: Array.isArray(p.members) ? p.members.length : 0,
        fremdriftProsent: p.completePercent != null ? Math.round(Number(p.completePercent)) : null,
        utfortDato: status === "utfort" && p.updated ? p.updated.slice(0, 10) : undefined
      };
    })
    .filter(Boolean);
}

function erForGammelTilAVaereAktiv(updated) {
  if (!updated) return true;
  const dagerSiden = (Date.now() - new Date(updated.replace(" ", "T") + "Z").getTime()) / 86400000;
  return dagerSiden > AKTIV_MAKS_DAGER_UTEN_OPPDATERING;
}
