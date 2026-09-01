// Regler for å normalisere Recman sin rå prosjektstatus til "aktiv"/"utfort"/"paVent"/null
// (skjult). Delt mellom functions/api/oppdrag.js (selve tavlen) og functions/api/feiring.js
// ("Nytt oppdrag" feires akkurat når et prosjekt blir synlig med status "aktiv" her -
// bekreftet av GreatPeople 2026-09-01 at det er DA de dukker opp på rådgivernes oversikt,
// ikke når første faktura sendes). Samme regler begge steder er derfor kritisk - endres
// noe her, gjelder det automatisk begge steder.

const BEHANDLE_100_PROSENT_SOM_UTFORT = true;
const KAN_LOFTES_VED_100_PROSENT = new Set(["notStarted", "active", "urgent", "solvedOngoing"]);
const AKTIV_MAKS_DAGER_UTEN_OPPDATERING = 90;

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

function erForGammelTilAVaereAktiv(updated) {
  if (!updated) return true;
  const dagerSiden = (Date.now() - new Date(updated.replace(" ", "T") + "Z").getTime()) / 86400000;
  return dagerSiden > AKTIV_MAKS_DAGER_UTEN_OPPDATERING;
}
