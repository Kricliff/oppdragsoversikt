// Henter de siste LinkedIn-innleggene fra folk hos oss (functions/api/linkedin.js) -
// vises i eget panel på tavlen.

async function hentLinkedin() {
  try {
    const res = await fetch("/api/linkedin", { cache: "no-store" });
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.innlegg) ? data.innlegg : [];
  } catch (err) {
    console.warn("Fikk ikke hentet LinkedIn-innlegg:", err);
    return [];
  }
}
