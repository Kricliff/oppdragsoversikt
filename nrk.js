// Henter siste toppsaker fra NRK og TV2 (functions/api/nrk.js) - vises i bunnbanneret
// når det ikke er noen aktive feiringer der.

async function hentNrkNyheter() {
  try {
    const res = await fetch("/api/nrk", { cache: "no-store" });
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.saker) ? data.saker : [];
  } catch (err) {
    console.warn("Fikk ikke hentet toppsaker:", err);
    return [];
  }
}
