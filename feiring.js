// Henter alle "aktive" feiringer (kandidat landet / ny kunde / nytt oppdrag) fra
// functions/api/feiring.js. Serveren regner selv ut hva som fortsatt skal vises - klienten
// speiler bare listen, og trenger derfor ikke holde styr på noe selv. Det gjør at banneret
// overlever en sideoppdatering (F5, eller tavlens egen auto-reload ved ny utrulling).

async function hentFeiring() {
  try {
    const res = await fetch("/api/feiring", { cache: "no-store" });
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.aktive) ? data.aktive : [];
  } catch (err) {
    console.warn("Fikk ikke hentet feiring-data:", err);
    return [];
  }
}
