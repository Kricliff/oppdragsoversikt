// Henter nye "feiring"-hendelser (kandidat landet / ny kunde) fra functions/api/feiring.js.
// Hver hendelse leveres kun én gang av serveren - klienten trenger ikke holde styr på hva
// som allerede er vist.

async function hentFeiring() {
  try {
    const res = await fetch("/api/feiring");
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.hendelser) ? data.hendelser : [];
  } catch (err) {
    console.warn("Fikk ikke hentet feiring-hendelser:", err);
    return [];
  }
}
