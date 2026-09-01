// Henter omtale av kundene fra Google News (functions/api/kundenytt.js) - vises i eget
// panel på tavlen.

async function hentKundenytt() {
  try {
    const res = await fetch("/api/kundenytt", { cache: "no-store" });
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.funn) ? data.funn : [];
  } catch (err) {
    console.warn("Fikk ikke hentet kundenytt:", err);
    return [];
  }
}
