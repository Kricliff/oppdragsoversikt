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

import { bestemStatus, kundeTypeSkalVises } from "../_lib/oppdragStatus.js";
// Cache-nøkkelen (og versjonen) ligger i _lib fordi skjulte.js må kunne blanke den når
// skjulelista endres - bump OPPDRAG_CACHE_VERSION der ved endringer i logikken under.
import { oppdragCacheKey } from "../_lib/oppdragCache.js";
import { harGyldigAdminNokkel, ikkeGodkjentSvar } from "../_lib/skrivevern.js";

const CACHE_SECONDS = 20 * 60;

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

// Manuelt parkerte oppdrag - enkeltoppdrag som skal bort fra tavlen selv om de fortsatt
// har en status som normalt vises. Typisk fordi de står "På vent" i RecMan sitt
// sekundære statusfelt, som ikke finnes i API-et i det hele tatt (se functions/api/
// skjulte.js for hele bakgrunnen). Lista styres fra /admin og ligger i KV, slik at
// oppdrag kan hentes tilbake uten en kodeendring.
const SKJULTE_KV_KEY = "skjulte-oppdrag";

async function hentSkjulteIder(kv) {
  if (!kv) return new Set();
  try {
    const liste = (await kv.get(SKJULTE_KV_KEY, "json")) ?? [];
    if (!Array.isArray(liste)) return new Set();
    return new Set(liste.map((s) => String(s?.id)));
  } catch (err) {
    // Får vi ikke lest lista, viser vi heller for mye enn å skjule feil oppdrag
    console.warn("Fikk ikke lest skjulte-oppdrag fra KV:", err);
    return new Set();
  }
}

export async function onRequestGet(context) {
  // ?diagnose=<del av tittel> svarer med HVILKET filter som tok et oppdrag, i stedet for
  // at man må gjette. Krever adminnøkkel og går bevisst utenom cachen, siden poenget er
  // å se tilstanden akkurat nå. Returnerer aldri hele porteføljen - kun treff på søket.
  const diagnoseSok = new URL(context.request.url).searchParams.get("diagnose");
  if (diagnoseSok) {
    if (!harGyldigAdminNokkel(context)) return ikkeGodkjentSvar(context, "oppdrag-diagnose");
    try {
      const svar = await hentOgNormaliser(
        context.env.RECMAN_API_KEY,
        await hentSkjulteIder(context.env.NOTAT_KV),
        diagnoseSok
      );
      return new Response(JSON.stringify({ kilde: svar.kilde, diagnose: svar.diagnose }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  const cache = caches.default;
  const cacheKey = oppdragCacheKey();
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await hentOgNormaliser(
      context.env.RECMAN_API_KEY,
      await hentSkjulteIder(context.env.NOTAT_KV)
    );
    // Må skje FØR responsen bygges (ikke context.waitUntil) - erNytt-flagget skal jo
    // faktisk være med i det som sendes til klienten.
    await merkNyeOppdrag(payload.oppdrag, context.env.NOTAT_KV);
    // Tidspunktet dette faktisk ble hentet fra Recman. Cachen gjør at svaret kan være
    // opptil CACHE_SECONDS gammelt, og uten dette er det umulig å se utenfra om dataen
    // er fersk eller har stått fast - fabrikkvisningen (/fabrikk) varsler på nettopp det.
    payload.hentet = Date.now();
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
// Hvor mange oppfriskninger på rad et oppdrag må være borte FØR vi tror på det.
// Recman sorterer lista selv mens vi paginerer (se den lange merknaden over
// MAKS_SIDER), så et oppdrag kan mangle i én henting og være tilbake i neste uten at
// noe er endret. Før dette ble en slik glipp logget som "borte" med én gang - og
// gjenkomsten som "nytt", siden oppdraget samtidig falt ut av forrige-bildet.
// Med CACHE_SECONDS på 20 minutter betyr 2 at et EKTE borte vises omtrent 40 minutter
// forsinket. Det er en bevisst avveining: heller sent og sant enn raskt og feil.
const BORTE_BEKREFTELSER = 2;

async function loggEndringer(oppdrag, kv) {
  if (!kv) return;

  const naaKart = {};
  oppdrag.forEach((o) => {
    naaKart[o.id] = { tittel: o.tittel, kunde: o.kunde, ansvarlig: o.ansvarlig, status: o.status };
  });

  const tilstand = (await kv.get(ENDRINGSLOGG_KV_KEY, "json")) ?? {};
  const forrige = tilstand.forrige ?? null;
  const hendelser = tilstand.hendelser ?? [];
  // id -> hvor mange oppfriskninger på rad oppdraget har manglet. Tom for alt som
  // er der nå, og nullstilles automatisk når et oppdrag dukker opp igjen.
  const mistenktBorte = tilstand.mistenktBorte ?? {};
  const naa = Date.now();
  const fortsattMistenkt = {};

  // Bootstrap-sikkert: kun diff når det faktisk finnes en forrige tilstand å diffe
  // mot, ellers ville aller første kjøring logget ALLE oppdrag som "nytt".
  if (forrige) {
    for (const [id, o] of Object.entries(forrige)) {
      if (naaKart[id]) continue;
      const runder = (mistenktBorte[id] ?? 0) + 1;
      if (runder >= BORTE_BEKREFTELSER) {
        hendelser.push({ tidspunkt: naa, type: "borte", ...o });
      } else {
        // Ikke tro på det ennå - vent til neste oppfriskning.
        fortsattMistenkt[id] = runder;
      }
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
  // Et oppdrag som er mistenkt borte blir stående i forrige-bildet. Uten dette ville
  // gjenkomsten lest som "nytt" - den andre halvdelen av flimringen.
  const nesteForrige = { ...naaKart };
  for (const id of Object.keys(fortsattMistenkt)) nesteForrige[id] = forrige[id];

  try {
    await kv.put(
      ENDRINGSLOGG_KV_KEY,
      JSON.stringify({ forrige: nesteForrige, hendelser: beholdt, mistenktBorte: fortsattMistenkt })
    );
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
    // Kun aktive oppdrag skal kunne vise "Ny" - et prosjekt kan gå rett til
    // Utført/Forespørsel etter å ha vært usynlig (f.eks. for gammelt/inaktivt), og blir
    // da "først sett" i vår sporing samme dag - men et avsluttet oppdrag er ikke "nytt".
    o.erNytt = o.status === "aktiv" && tilstand[o.id] > grense;
  });
}

// Recman leverer prosjekter sidevis. Vi hentet tidligere KUN side 1, og alt som lå
// utenfor den siden fantes rett og slett ikke for tavlen. Fordi Recman sorterer listen
// selv, flyttet prosjekter seg inn og ut av side 1 hver gang noe ble redigert - da
// forsvant oppdrag fra tavlen og dukket opp igjen av seg selv, uten at noe var endret
// på selve oppdraget. Bekreftet 2026-09-15: "FLO AS - Kommersiell Leder" og et
// Cegal-oppdrag forsvant i nøyaktig samme sekund, og Cegal hadde vært innom samme
// forsvinning og gjenkomst dagen før.
//
// RETTET (2026-09-16): å hente alle sidene fikk problemet til å skje sjeldnere, men
// ikke til å forsvinne - bekreftet i den ekte endringsloggen at "Azets Insight AS -
// INTERIM - Teamleder Regnskap (937)" flimret nytt/borte i perfekt synk med nettopp
// Cegal- og FLO-oppdragene igjen, lenge etter denne fiksen. Årsaken satt igjen: sidene
// ble hentet SEKVENSIELT, én om gangen, og det tar reell tid å hente opptil 20 sider -
// nok tid til at noen rekker å redigere et ANNET prosjekt i Recman midt i vår egen
// henting, som flytter prosjekter mellom sider Recman selv sorterer. Et prosjekt som
// flytter seg fra en side vi ikke har hentet ennå til en side vi allerede har passert,
// forsvinner sporløst for akkurat den oppfriskningen.
//
// Fasit: hent sidene i SAMTIDIGE bolker (SIDE_BATCH om gangen) i stedet for én og én -
// det krymper tidsvinduet reordringen kan skje i med omtrent en faktor SIDE_BATCH,
// uten å øke antall Recman-kall utover det som allerede var nødvendig for å finne
// slutten av listen (se stopp-logikken under, uendret prinsipp: stopp ved første tomme
// eller feilende side, i sidenes rekkefølge - selv om de ble hentet samtidig).
// Hver enkelt side prøves også på nytt et par ganger ved en forbigående feil, i stedet
// for å tolke en forbigående nettverksglipp som "her sluttet dataene".
const MAKS_SIDER = 20;
const SIDE_BATCH = 5;
const SIDE_FORSOK = 3;

async function hentSideMedForsok(apiKey, projectFields, side) {
  let sisteFeil = null;
  for (let forsok = 1; forsok <= SIDE_FORSOK; forsok++) {
    try {
      const url = `https://api.recman.io/v2/get/?key=${apiKey}&scope=project&fields=${projectFields}&page=${side}`;
      const json = await fetch(url).then((r) => r.json());
      if (json.success) return json;
      sisteFeil = json.error;
    } catch (err) {
      sisteFeil = String(err.message ?? err);
    }
    if (forsok < SIDE_FORSOK) await new Promise((r) => setTimeout(r, 300 * forsok));
  }
  return { success: false, error: sisteFeil };
}

async function hentAlleProsjekter(apiKey, projectFields) {
  const alle = {};
  let sider = 0;

  for (let batchStart = 1; batchStart <= MAKS_SIDER; batchStart += SIDE_BATCH) {
    const sideNumre = [];
    for (let s = batchStart; s < batchStart + SIDE_BATCH && s <= MAKS_SIDER; s++) sideNumre.push(s);

    const svar = await Promise.all(sideNumre.map((side) => hentSideMedForsok(apiKey, projectFields, side)));

    let noeNytt = false;
    let stoppEtterBatch = false;
    for (let i = 0; i < svar.length; i++) {
      const json = svar[i];
      const side = sideNumre[i];

      if (!json.success) {
        // Feiler den aller første siden (etter SIDE_FORSOK forsøk) har vi ingenting å
        // vise, og da skal det smelle. Feiler en senere side er et delvis resultat
        // bedre enn å miste hele tavlen - men vi stopper HER (i sidenes rekkefølge),
        // ikke bare hopper over den ene siden, for å unngå et hull midt i listen om en
        // senere side i samme bolk skulle lykkes.
        if (side === 1) throw new Error("Recman project-feil: " + JSON.stringify(json.error));
        stoppEtterBatch = true;
        break;
      }

      const rader = Object.values(json.data ?? {});
      if (!rader.length) { stoppEtterBatch = true; break; }

      const forAntall = Object.keys(alle).length;
      for (const p of rader) alle[p.projectId] = p;
      sider = side;
      if (Object.keys(alle).length > forAntall) noeNytt = true;
      // Se opprinnelig kommentar: skulle Recman ignorere page-parameteren og gi samme
      // side om igjen, gir ikke det flere unike rader - fanges opp av noeNytt under.
    }

    if (stoppEtterBatch || !noeNytt) break;
  }

  return { prosjekter: Object.values(alle), sider };
}

async function hentOgNormaliser(apiKey, skjulteIder = new Set(), diagnoseSok = null) {
  if (!apiKey) throw new Error("RECMAN_API_KEY er ikke satt");

  const projectFields = "name,status,completePercent,companyId,responsibleUserId,updated,members,startDate,endDate";
  const userUrl = `https://api.recman.io/v1.php?key=${apiKey}&type=json&scope=user&fields=first_name,last_name`;

  const [prosjektKilde, userJson] = await Promise.all([
    hentAlleProsjekter(apiKey, projectFields),
    fetch(userUrl).then((r) => r.json()).catch(() => null)
  ]);
  const projectJson = { data: prosjektKilde.prosjekter };

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

  // Når et oppdrag mangler fra tavlen er det nesten alltid fordi ETT av filtrene under
  // slo til - men utenfra er alle utfallene like usynlige. diagnose samler derfor opp
  // hvilket filter som faktisk tok et gitt oppdrag, slik at spørsmålet kan besvares med
  // en måling i stedet for gjetting. Se ?diagnose= i onRequestGet (krever adminnøkkel).
  const diagnose = [];
  const sokTekst = (diagnoseSok ?? "").toLowerCase();
  const merk = (p, grunn) => {
    if (!sokTekst || !String(p.name ?? "").toLowerCase().includes(sokTekst)) return;
    diagnose.push({
      tittel: p.name,
      grunn,
      raaStatus: p.status,
      fremdrift: p.completePercent,
      oppdatert: p.updated,
      dagerSidenOppdatert: p.updated
        ? Math.round((Date.now() - new Date(p.updated.replace(" ", "T") + "Z").getTime()) / 86400000)
        : null,
      kundeType: kundeType[p.companyId] ?? null,
      ansvarligFunnet: !!radgiverNavn[p.responsibleUserId]
    });
  };

  const oppdrag = Object.values(projectJson.data)
    .map((p) => {
      if (skjulteIder.has(String(p.projectId))) { merk(p, "parkert fra admin"); return null; }

      const status = bestemStatus(p);
      if (!status) { merk(p, "statusfilter (avlyst/tapt, eller aktiv uten oppdatering på over 90 dager)"); return null; }

      // Recman-kunder er typet (customer/prospect/ownCompany/formerCustomer/osv). Prosjekter
      // knyttet til f.eks. et "prospect" er salgsoppfølging, ikke et reelt kundeoppdrag -
      // luk dem bort så tavlen bare viser arbeid for faktiske kunder. Slår aldri filteret på
      // hvis kundedata ikke lot seg hente (kundedataLastetOk === false) - da vises alt,
      // heller enn å risikere å skjule ekte oppdrag pga. en API-feil.
      if (kundedataLastetOk && kundeType[p.companyId] && !kundeTypeSkalVises(kundeType[p.companyId], status)) {
        merk(p, "kundetypefilter (" + kundeType[p.companyId] + ")");
        return null;
      }

      // Kan vi ikke slå opp en faktisk rådgiver, viser vi ikke oppdraget i det hele tatt -
      // et "Ukjent rådgiver"-oppdrag er uverifiserbart (person som har forlatt firmaet,
      // feilregistrering, e.l.) og skal ikke telle med i "Utført i år" eller stå på tavlen.
      const ansvarlig = radgiverNavn[p.responsibleUserId];
      if (!ansvarlig) { merk(p, "fant ingen rådgiver for responsibleUserId " + p.responsibleUserId); return null; }
      merk(p, "VISES på tavlen");

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

  // Tellere som gjør det mulig å se utenfra hvorfor et oppdrag ikke står på tavlen:
  // ble det aldri hentet fra Recman, eller ble det filtrert bort her?
  return {
    oppdrag,
    kilde: {
      raaAntall: prosjektKilde.prosjekter.length,
      sider: prosjektKilde.sider,
      filtrertBort: prosjektKilde.prosjekter.length - oppdrag.length
    },
    diagnose: diagnoseSok ? diagnose : undefined
  };
}
