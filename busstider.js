// Henter sanntid busstider fra functions/api/avganger.js (Entur/Ruter-data for
// holdeplassen nær kontoret). Faller stille tilbake til tom liste ved feil - et
// busstider-panel som forsvinner er ikke kritisk for tavlen slik oppdrag er.

async function hentAvganger() {
  try {
    const res = await fetch("/api/avganger", { cache: "no-store" });
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.avganger)) throw new Error("Uventet svarformat fra /api/avganger");
    return data;
  } catch (err) {
    console.warn("Fikk ikke hentet busstider:", err);
    return { holdeplass: null, avganger: [] };
  }
}
