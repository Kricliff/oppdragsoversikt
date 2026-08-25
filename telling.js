// Henter/oppdaterer den manuelle tellingen (telefoner/møter) fra functions/api/telling.js.

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

async function oppdaterTelling(felt, endring) {
  try {
    const res = await fetch("/api/telling", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ felt, endring })
    });
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("Fikk ikke oppdatert telling:", err);
    return null;
  }
}
