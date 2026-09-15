// Regler for å normalisere Recman sin rå prosjektstatus til "aktiv"/"utfort"/"paVent"/null
// (skjult). Delt mellom functions/api/oppdrag.js (selve tavlen) og functions/api/feiring.js
// ("Nytt oppdrag" feires akkurat når et prosjekt blir synlig med status "aktiv" her -
// bekreftet av GreatPeople 2026-09-01 at det er DA de dukker opp på rådgivernes oversikt,
// ikke når første faktura sendes). Samme regler begge steder er derfor kritisk - endres
// noe her, gjelder det automatisk begge steder.

const BEHANDLE_100_PROSENT_SOM_UTFORT = true;
const KAN_LOFTES_VED_100_PROSENT = new Set(["notStarted", "active", "urgent", "solvedOngoing"]);
const AKTIV_MAKS_DAGER_UTEN_OPPDATERING = 90;

// "request" er internt kalt "paVent" i denne koden (variabelnavn/CSS-klasser/JSON-felt
// endres ikke), men Recman sin egen "fase" for denne statusen heter FORESPØRSEL, ikke
// "På vent" (bekreftet i help.recman.io "Prosjekt modulen" 2026-09-02, etter at Fredrik
// Aaslestad meldte at hans forespørsel-prosjekter feilaktig viste "På vent" på tavlen).
// "På vent" er faktisk en helt ANNEN, separat statusverdi i Recman (Ikke satt/I rute/
// I fare/På vent/Av kurs/Fullført) som vi ikke henter eller bruker noe sted. Selve
// visningsteksten er derfor rettet til "Forespørsel" (se statusLabel() i app.js og
// STATUS_NAVN i admin/index.html) - kun label-en var feil, dataene/logikken er riktig.
const STATUS_MAP = {
  notStarted: "aktiv",
  active: "aktiv",
  urgent: "aktiv",
  solvedEnded: "utfort",
  request: "paVent"
};

export function bestemStatus(p) {
  let status = STATUS_MAP[p.status];

  if (BEHANDLE_100_PROSENT_SOM_UTFORT && KAN_LOFTES_VED_100_PROSENT.has(p.status) && Number(p.completePercent) >= 100) {
    status = "utfort";
  }

  if (!status) return null; // cancelled/lost/solvedOngoing under 100% - skjules
  if (status === "aktiv" && erForGammelTilAVaereAktiv(p.updated)) return null;
  return status;
}

// Recman-kunder er typet (customer/prospect/ownCompany/formerCustomer/subcontractor/...).
// Prosjekter på f.eks. et "prospect" er salgsoppfølging, ikke et reelt kundeoppdrag, og
// skal ikke stå på tavlen.
//
// formerCustomer er unntaket (lagt til 2026-09-15): en TIDLIGERE kunde kan ikke ha et
// pågående oppdrag - det er en selvmotsigelse i dataene. Da er prosjektet det ferske
// signalet og kundetypen den som henger etter. Bakgrunn: "FLO AS - Kommersiell Leder"
// og et Cegal-oppdrag forsvant fra tavlen mens de var aktive og oppdatert samme dag,
// kun fordi kunden var merket som tidligere kunde. Unntaket gjelder BARE aktive oppdrag -
// et utført oppdrag for en tidligere kunde er ingen selvmotsigelse, og telleverket for
// "Utført i år" skal derfor ikke endre seg av dette.
//
// Merk: funksjonen svarer kun på hva en KJENT type skal føre til. Hva som skjer når typen
// mangler avgjør kallstedet selv - tavlen viser da heller for mye enn å skjule ekte
// arbeid, mens feiringen heller lar være å feire enn å feire noe feil.
export function kundeTypeSkalVises(kundeType, status) {
  if (kundeType === "customer") return true;
  if (kundeType === "formerCustomer" && status === "aktiv") return true;
  return false;
}

function erForGammelTilAVaereAktiv(updated) {
  if (!updated) return true;
  const dagerSiden = (Date.now() - new Date(updated.replace(" ", "T") + "Z").getTime()) / 86400000;
  return dagerSiden > AKTIV_MAKS_DAGER_UTEN_OPPDATERING;
}
