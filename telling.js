// Henter ekte telefon-/salgsmøte-telling fra functions/api/telling.js (Recman sin
// "log"-scope). Rent lesende - ingen manuell input, tallene kommer fra Recman.

async function hentTelling() {
  try {
    const res = await fetch("/api/telling");
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("Fikk ikke hentet telling:", err);
    return { telefoner: 0, moter: 0 };
  }
}
