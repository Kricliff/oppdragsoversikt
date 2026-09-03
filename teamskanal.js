// Henter siste meldinger fra Teams-kanalen "GreatPeople på kontoret"
// (functions/api/teamskanal.js) - vises i eget panel på tavlen.

async function hentTeamskanal() {
  try {
    const res = await fetch("/api/teamskanal", { cache: "no-store" });
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.meldinger) ? data.meldinger : [];
  } catch (err) {
    console.warn("Fikk ikke hentet teamskanal:", err);
    return [];
  }
}
