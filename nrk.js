// Henter siste overskrifter fra NRK (functions/api/nrk.js) - vises i bunnbanneret
// når det ikke er noen aktive feiringer der.

async function hentNrkNyheter() {
  try {
    const res = await fetch("/api/nrk");
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.overskrifter) ? data.overskrifter : [];
  } catch (err) {
    console.warn("Fikk ikke hentet NRK-nyheter:", err);
    return [];
  }
}
