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

import { bestemStatus } from "../_lib/oppdragStatus.js";

const CACHE_SECONDS = 20 * 60;
// Bump denne når normaliseringslogikken under endres, slik at gamle cachede svar fra
// før endringen ikke fortsetter å bli servert i opptil CACHE_SECONDS etter en deploy.
const CACHE_VERSION = 25;

// Selve status-normaliseringen (Recman sine rå statuser -> aktiv/utfort/paVent/skjult,
// inkludert 100%-regelen og "for gammel til å være aktiv"-filteret) ligger i
// _lib/oppdragStatus.js - DELT med functions/api/feiring.js, som bruker nøyaktig samme
// regler til å avgjøre når "Nytt oppdrag" skal feires (se kommentar der).

// PILOT (2026-09-02, kun for Fredrik Aaslestad): prosent regnes ut fra hvor langt inn i
// prosjektets periode (startDate->endDate, "Periode" i Recman) vi er, i stedet for
// Recman sin egen completePercent - som i praksis sjelden oppdateres manuelt av
// rådgiverne. Brukes KUN når begge datoene faktisk er satt, ellers vises completePercent
// som normalt (uendret for alle andre rådgivere).
const PERIODE_PROSENT_RADGIVERE = new Set(["Fredrik Aaslestad"]);

function beregnPeriodeProsent(startDate, endDate) {
  const start = new Date(startDate).getTime();
  const slutt = new Date(endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(slutt) || slutt <= start) return null;
  const andel = (Date.now() - start) / (slutt - start);
  return Math.round(Math.max(0, Math.min(100, andel * 100)));
}

// Manuelt skjulte prosjekt-ID-er - enkeltoppdrag som skal bort fra tavlen på forespørsel,
// selv om de fortsatt har en status som normalt vises. 1296846: "Direct Search Recruitment
// - IT x3" hos Uno-X (Kristian Clifford, "på vent") - be om å fjerne den 2026-09-01.
// 1297972: "Init4U-DS-Leder Accounting" hos Init4U (Fredrik Aaslestad) - satt til feil
// fase i RecMan, skal ikke være på tavlen ennå - be om å fjerne den 2026-09-01.
const SKJULTE_PROSJEKT_IDER = new Set(["1296846", "1297972"]);

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/oppdrag?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await hentOgNormaliser(context.env.RECMAN_API_KEY);
    // Må skje FØR responsen bygges (ikke context.waitUntil) - erNytt-flagget skal jo
    // faktisk være med i det som sendes til klienten.
    await merkNyeOppdrag(payload.oppdrag, context.env.NOTAT_KV);
    const response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    // Logger nye/borte/status-endrede oppdrag til KV, til bruk i endringsloggen på
    // /admin (functions/api/endringslogg.js) - kjører kun ved et faktisk cache-miss,
    // altså på samme kadens som tavlen selv faktisk friskes opp mot Recman.
    context.waitUntil(loggEndringer(payload.oppdrag, context.env.NOTAT_KV));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

const ENDRINGSLOGG_KV_KEY = "oppdrag-endringslogg";
const ENDRINGSLOGG_VIS_DAGER = 14; // hvor lenge en hendelse beholdes i loggen

async function loggEndringer(oppdrag, kv) {
  if (!kv) return;

  const naaKart = {};
  oppdrag.forEach((o) => {
    naaKart[o.id] = { tittel: o.tittel, kunde: o.kunde, ansvarlig: o.ansvarlig, status: o.status };
  });

  const tilstand = (await kv.get(ENDRINGSLOGG_KV_KEY, "json")) ?? {};
  const forrige = tilstand.forrige ?? null;
  const hendelser = tilstand.hendelser ?? [];
  const naa = Date.now();

  // Bootstrap-sikkert: kun diff når det faktisk finnes en forrige tilstand å diffe
  // mot, ellers ville aller første kjøring logget ALLE oppdrag som "nytt".
  if (forrige) {
    for (const [id, o] of Object.entries(forrige)) {
      if (!naaKart[id]) hendelser.push({ tidspunkt: naa, type: "borte", ...o });
    }
    for (const [id, o] of Object.entries(naaKart)) {
      if (!forrige[id]) {
        hendelser.push({ tidspunkt: naa, type: "nytt", ...o });
      } else if (forrige[id].status !== o.status) {
        hendelser.push({ tidspunkt: naa, type: "status", ...o, statusFor: forrige[id].status });
      }
    }
  }

  const grense = naa - ENDRINGSLOGG_VIS_DAGER * 24 * 60 * 60 * 1000;
  const beholdt = hendelser.filter((h) => h.tidspunkt > grense);

  // Kjøres via context.waitUntil (se onRequestGet) og påvirker derfor ikke selve
  // svaret om den feiler - fanges likevel her for å unngå støy i loggene ved en
  // feilet skriving (f.eks. KV sin daglige gratiskvote brukt opp).
  try {
    await kv.put(ENDRINGSLOGG_KV_KEY, JSON.stringify({ forrige: naaKart, hendelser: beholdt }));
  } catch (err) {
    console.warn("Fikk ikke skrevet endringslogg til KV:", err);
  }
}

const NY_MERKE_KV_KEY = "oppdrag-forstesett";
const NY_MERKE_DAGER = 3; // hvor lenge "Ny"-merket vises på et oppdrag-kort

// Merker hvert oppdrag med erNytt: true i NY_MERKE_DAGER dager etter det FØRST dukket
// opp på tavlen - lagret varig per oppdrag-id (recman-<projectId>), som aldri endres.
// Flyttes oppdraget til en annen rådgiver er det fortsatt samme id, så "først sett"-
// tidspunktet - og dermed selve "Ny"-merket - påvirkes ikke av en omplassering.
async function merkNyeOppdrag(oppdrag, kv) {
  if (!kv) return;

  const tilstand = (await kv.get(NY_MERKE_KV_KEY, "json")) ?? {};
  const erBootstrap = Object.keys(tilstand).length === 0;
  const naa = Date.now();
  // Ved aller første kjøring skal ikke hele den eksisterende porteføljen merkes "Ny" -
  // lagre et tidspunkt godt utenfor NY_MERKE_DAGER-vinduet, som om vi allerede kjente
  // til dem (samme bootstrap-mønster som loggEndringer/feiring.js).
  const forstegangsTidspunkt = naa - (NY_MERKE_DAGER + 1) * 24 * 60 * 60 * 1000;

  const aktiveIder = new Set(oppdrag.map((o) => o.id));
  // Rydd bort oppdrag som ikke lenger er synlige - "først sett" trengs ikke for dem
  // lenger, og dukker de opp igjen senere regnes de naturlig som nye på nytt da.
  Object.keys(tilstand).forEach((id) => {
    if (!aktiveIder.has(id)) delete tilstand[id];
  });

  oppdrag.forEach((o) => {
    if (!tilstand[o.id]) tilstand[o.id] = erBootstrap ? forstegangsTidspunkt : naa;
  });

  try {
    await kv.put(NY_MERKE_KV_KEY, JSON.stringify(tilstand));
  } catch (err) {
    console.warn("Fikk ikke skrevet oppdrag-forstesett til KV:", err);
  }

  const grense = naa - NY_MERKE_DAGER * 24 * 60 * 60 * 1000;
  oppdrag.forEach((o) => {
    o.erNytt = tilstand[o.id] > grense;
  });
}

async function hentOgNormaliser(apiKey) {
  if (!apiKey) throw new Error("RECMAN_API_KEY er ikke satt");

  const projectFields = "name,status,completePercent,companyId,responsibleUserId,updated,members,startDate,endDate";
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

  const oppdrag = Object.values(projectJson.data)
    .map((p) => {
      if (SKJULTE_PROSJEKT_IDER.has(String(p.projectId))) return null;

      const status = bestemStatus(p);
      if (!status) return null; // cancelled/lost/solvedOngoing under 100% - skjules

      // Recman-kunder er typet (customer/prospect/ownCompany/formerCustomer/osv). Prosjekter
      // knyttet til f.eks. et "prospect" er salgsoppfølging, ikke et reelt kundeoppdrag -
      // luk dem bort så tavlen bare viser arbeid for faktiske kunder. Slår aldri filteret på
      // hvis kundedata ikke lot seg hente (kundedataLastetOk === false) - da vises alt,
      // heller enn å risikere å skjule ekte oppdrag pga. en API-feil.
      if (kundedataLastetOk && kundeType[p.companyId] && kundeType[p.companyId] !== "customer") return null;

      // Kan vi ikke slå opp en faktisk rådgiver, viser vi ikke oppdraget i det hele tatt -
      // et "Ukjent rådgiver"-oppdrag er uverifiserbart (person som har forlatt firmaet,
      // feilregistrering, e.l.) og skal ikke telle med i "Utført i år" eller stå på tavlen.
      const ansvarlig = radgiverNavn[p.responsibleUserId];
      if (!ansvarlig) return null;

      let fremdriftProsent = p.completePercent != null ? Math.round(Number(p.completePercent)) : null;
      if (PERIODE_PROSENT_RADGIVERE.has(ansvarlig) && p.startDate && p.endDate) {
        const periodeProsent = beregnPeriodeProsent(p.startDate, p.endDate);
        if (periodeProsent !== null) fremdriftProsent = periodeProsent;
      }

      return {
        id: "recman-" + p.projectId,
        tittel: p.name,
        kunde: kundeNavn[p.companyId] ?? `Kunde #${p.companyId}`,
        ansvarlig,
        status,
        fremdriftProsent,
        // Full presisjon (ikke bare datoen) - trengs for å kunne skille "fullført før
        // eller etter et gitt tidspunkt", se UTFORT_BASISDATO i app.js.
        utfortDato: status === "utfort" && p.updated ? p.updated.replace(" ", "T") + "Z" : undefined,
        paVentDato: status === "paVent" && p.updated ? p.updated.replace(" ", "T") + "Z" : undefined
      };
    })
    .filter(Boolean);

  return { oppdrag };
}
