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
const CACHE_VERSION = 12;

// EKSPERIMENT (2026-08-25): mange rådgivere glemmer å sette prosjektstatus til "Løst"
// når de er ferdige, men husker som regel å sette fremdrift til 100%. Til det motsatte
// er bevist, behandler vi 100% fremdrift som utført uansett hva statusfeltet sier -
// men aldri for cancelled/lost, som er en bevisst avsluttet-uten-suksess-tilstand.
const BEHANDLE_100_PROSENT_SOM_UTFORT = true;

// Faser som kan LØFTES til "utfort" via 100%-regelen over (i tillegg til solvedEnded,
// som alltid er utfort uansett prosent).
const KAN_LOFTES_VED_100_PROSENT = new Set(["notStarted", "active", "urgent", "solvedOngoing"]);

// Recman inneholder mange gamle prosjekter som ble satt til "active"/"urgent" og aldri
// lukket - reelt sett forlatte, ikke faktisk aktivt arbeid. Et "aktiv"-oppdrag som ikke
// er rørt i Recman på lenger enn dette regnes ikke som aktivt lenger, og skjules.
const AKTIV_MAKS_DAGER_UTEN_OPPDATERING = 90;

// Recman sine prosjekt-statuser (se help.recman.io "Projects module") normalisert til
// det tavlen forstår. "cancelled" og "lost" er bevisst utelatt - de skal ikke vises,
// og alt som ikke er "aktiv"/"utfort" skjules automatisk av erSynligPaTavle i app.js.
//
// "request" (= "På vent" i Recman sitt grensesnitt) er bevisst IKKE med her (2026-08-25)
// - ble for mye støy på tavlen. De dukker opp av seg selv når noen setter dem til
// active/urgent/notStarted i Recman, i stedet for å ta opp plass som en egen kolonne.
//
// "solvedOngoing" ("Løst løpende") er bevisst IKKE med her (2026-08-25) - "Utført i år"
// skal kun telle solvedEnded ("Løst avsluttet") + 100%-regelen under, ikke løpende
// leveranser. Et solvedOngoing-prosjekt under 100% skjules derfor helt fra tavlen,
// akkurat som cancelled/lost/request - det når 100% (og telles) i stedet.
const STATUS_MAP = {
  notStarted: "aktiv",
  active: "aktiv",
  urgent: "aktiv",
  solvedEnded: "utfort"
};

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/oppdrag?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await hentOgNormaliser(context.env.RECMAN_API_KEY);
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

  await kv.put(ENDRINGSLOGG_KV_KEY, JSON.stringify({ forrige: naaKart, hendelser: beholdt }));
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

  const oppdrag = Object.values(projectJson.data)
    .map((p) => {
      let status = STATUS_MAP[p.status];

      if (BEHANDLE_100_PROSENT_SOM_UTFORT && KAN_LOFTES_VED_100_PROSENT.has(p.status) && Number(p.completePercent) >= 100) {
        status = "utfort";
      }

      if (!status) return null; // cancelled/lost/request/solvedOngoing under 100% - skjules

      if (status === "aktiv" && erForGammelTilAVaereAktiv(p.updated)) return null;
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

      return {
        id: "recman-" + p.projectId,
        tittel: p.name,
        kunde: kundeNavn[p.companyId] ?? `Kunde #${p.companyId}`,
        ansvarlig,
        status,
        fremdriftProsent: p.completePercent != null ? Math.round(Number(p.completePercent)) : null,
        utfortDato: status === "utfort" && p.updated ? p.updated.slice(0, 10) : undefined
      };
    })
    .filter(Boolean);

  const kandidaterLandetIAr = await hentKandidaterLandetIAr(apiKey);

  return { oppdrag, kandidaterLandetIAr };
}

// Ekte antall kandidater "landet" (ansatt) i år, fra "jobApplication"-scopen (status
// "hired"). Dette er IKKE koblet til enkeltoppdrag - det krever "job post"-tilgang vi
// ikke har (jobApplication peker på jobPostId, ikke projectId) - men gir et pålitelig
// totaltall for statslinjen, i stedet for den gamle tilnærmingen som talte
// teammedlemmer/kundekontakter på fullførte prosjekter.
async function hentKandidaterLandetIAr(apiKey) {
  try {
    const url = `https://api.recman.io/v2/get/?key=${apiKey}&scope=jobApplication&page=1&status=hired`;
    const json = await fetch(url).then((r) => r.json());
    if (!json.success) return null;
    const iAr = new Date().getFullYear();
    return json.data.filter((a) => a.updated && new Date(a.updated.replace(" ", "T") + "Z").getFullYear() === iAr).length;
  } catch {
    return null;
  }
}

function erForGammelTilAVaereAktiv(updated) {
  if (!updated) return true;
  const dagerSiden = (Date.now() - new Date(updated.replace(" ", "T") + "Z").getTime()) / 86400000;
  return dagerSiden > AKTIV_MAKS_DAGER_UTEN_OPPDATERING;
}
