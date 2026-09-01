// Henter bursdagslisten (lagt inn manuelt på /admin, functions/api/bursdager.js) -
// brukes til å vise neste bursdag i statslinjen og til å rulle en feiring midt på
// skjermen på selve dagen.

async function hentBursdager() {
  try {
    const res = await fetch("/api/bursdager", { cache: "no-store" });
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.bursdager) ? data.bursdager : [];
  } catch (err) {
    console.warn("Fikk ikke hentet bursdager:", err);
    return [];
  }
}
