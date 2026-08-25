const AUTO_REFRESH_MS = 5 * 60 * 1000; // skjermen skal stå ubetjent, så data friskes opp selv
const UTFORT_SYNLIG_DAGER = 7; // et "Utført"-oppdrag blir stående på tavlen i 7 dager før det forsvinner
const PALETTE_SIZE = 8;
const STATUS_PRIORITET = { aktiv: 0, utfort: 1 };
const BUSS_REFRESH_MS = 30 * 1000; // sanntid - friskes opp oftere enn oppdrag
const BUSS_TIKK_MS = 15 * 1000; // tikker ned "om X min" mellom hver reell henting
const DEPLOY_SJEKK_MS = 2 * 60 * 1000; // skjermen kjører ubetjent - må selv oppdage nye deploys
const DEPLOY_SJEKK_FILER = ["/index.html", "/style.css", "/app.js", "/busstider.js", "/recman-adapter.js", "/telling.js"];
const TELLING_REFRESH_MS = 60 * 1000; // flere kan klikke fra ulike enheter - hold i sync

let alleOppdrag = [];
let sisteAvganger = [];
let sisteKodeInnhold = null;
let sisteTelling = { telefoner: 0, moter: 0 };

const lanesEl = document.getElementById("lanes");
const statsRow = document.getElementById("statsRow");
const sourceBadge = document.getElementById("sourceBadge");
const updatedLabel = document.getElementById("updatedLabel");
const emptyState = document.getElementById("emptyState");
const clockEl = document.getElementById("clock");
const dateLabelEl = document.getElementById("dateLabel");
const refreshBtn = document.getElementById("refreshBtn");
const notatEl = document.getElementById("notatTekst");
const busstiderListeEl = document.getElementById("busstiderListe");

async function init() {
  await lastTelling();
  await lastOppdrag();
  tikkKlokke();
  lastNotat();
  lastBusstider();
  setInterval(tikkKlokke, 1000);
  setInterval(lastOppdrag, AUTO_REFRESH_MS);
  setInterval(lastNotat, AUTO_REFRESH_MS);
  setInterval(lastBusstider, BUSS_REFRESH_MS);
  setInterval(renderBusstider, BUSS_TIKK_MS);
  setInterval(lastTelling, TELLING_REFRESH_MS);
  sjekkNyVersjon();
  setInterval(sjekkNyVersjon, DEPLOY_SJEKK_MS);
  refreshBtn.addEventListener("click", () => lastOppdrag());
  binderNotat();
  bindTelling();
}

// Skjermen står ubetjent og laster aldri siden på nytt av seg selv - uten dette ville
// en ny deploy (kode-endring) aldri vist seg før noen fysisk går bort og trykker F5.
// Henter de statiske filene direkte (utenom cache) og sammenligner mot det som ble
// lastet sist - endrer noe seg, er det deployet ny kode, og siden laster seg selv på nytt.
async function sjekkNyVersjon() {
  try {
    const tekster = await Promise.all(
      DEPLOY_SJEKK_FILER.map((url) => fetch(url, { cache: "no-store" }).then((r) => r.text()))
    );
    const samlet = tekster.join(" ");
    if (sisteKodeInnhold === null) {
      sisteKodeInnhold = samlet;
      return;
    }
    if (samlet !== sisteKodeInnhold) {
      location.reload();
    }
  } catch (err) {
    console.warn("Fikk ikke sjekket ny versjon:", err);
  }
}

async function lastOppdrag() {
  refreshBtn.classList.add("spinning");
  try {
    alleOppdrag = await hentOppdrag();
    sourceBadge.textContent = kildeErRecman() ? "Kilde: Recman" : "Kilde: mock-data";
    updatedLabel.textContent = `Sist oppdatert: ${new Date().toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })}`;
    render();
  } catch (err) {
    sourceBadge.textContent = "Feil ved lasting";
    console.error(err);
  } finally {
    setTimeout(() => refreshBtn.classList.remove("spinning"), 400);
  }
}

// Delt post-it-lapp - lagres server-side (functions/api/notat.js) slik at alle som ser
// på skjermen ser samme melding. Henter jevnlig, men skriver aldri over teksten mens
// noen faktisk står og skriver i den (document.activeElement-sjekken under).
let notatLagreTimer = null;

async function lastNotat() {
  if (document.activeElement === notatEl) return; // ikke overskriv mens noen skriver
  try {
    const res = await fetch("/api/notat");
    if (!res.ok) return;
    const data = await res.json();
    notatEl.value = data.tekst ?? "";
  } catch (err) {
    console.warn("Fikk ikke hentet notat:", err);
  }
}

function binderNotat() {
  notatEl.addEventListener("input", () => {
    clearTimeout(notatLagreTimer);
    notatLagreTimer = setTimeout(lagreNotat, 1500);
  });
  notatEl.addEventListener("blur", () => {
    clearTimeout(notatLagreTimer);
    lagreNotat();
  });
}

async function lagreNotat() {
  try {
    await fetch("/api/notat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tekst: notatEl.value })
    });
  } catch (err) {
    console.warn("Fikk ikke lagret notat:", err);
  }
}

// Busstider fra holdeplassen ved kontoret (functions/api/avganger.js, ekte
// Entur/Ruter-sanntidsdata). sisteAvganger caches lokalt slik at "om X min"-teksten
// kan tikke ned mellom hver reelle henting, uten å måtte spørre API-et hvert 15. sekund.
async function lastBusstider() {
  const data = await hentAvganger();
  sisteAvganger = data.avganger;
  renderBusstider();
}

function renderBusstider() {
  busstiderListeEl.innerHTML = "";
  if (sisteAvganger.length === 0) {
    busstiderListeEl.innerHTML = '<div class="buss-tom">Ingen avganger akkurat nå</div>';
    return;
  }
  sisteAvganger.forEach((a) => {
    const rad = document.createElement("div");
    rad.className = "buss-rad";
    rad.innerHTML = `
      <span class="buss-linje">${escapeHtml(a.linje)}</span>
      <span class="buss-destinasjon">${escapeHtml(a.destinasjon)}</span>
      <span class="buss-tid">${busstidTekst(a.avgangstid)}</span>
    `;
    busstiderListeEl.appendChild(rad);
  });
}

function busstidTekst(iso) {
  const tid = new Date(iso).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
  const min = Math.round((new Date(iso) - new Date()) / 60000);
  return min <= 0 ? `${tid} (nå)` : `${tid} (${min} min)`;
}

function tikkKlokke() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  dateLabelEl.textContent = now.toLocaleDateString("no-NO", { weekday: "long", day: "numeric", month: "long" });
}

function render() {
  const pagaende = alleOppdrag.filter(erSynligPaTavle);
  // Statuslinjen skal vise tall for hele året, ikke bare det som fortsatt
  // er synlig på tavlen (utført-kort forsvinner der etter UTFORT_SYNLIG_DAGER).
  renderStats(alleOppdrag);
  renderLanes(pagaende);
  tilpassKortStorrelseTilSkjerm();
  emptyState.hidden = pagaende.length > 0;
}

function erSynligPaTavle(o) {
  if (o.status === "aktiv") return true;
  if (o.status === "utfort") return dagerSiden(o.utfortDato) <= UTFORT_SYNLIG_DAGER;
  return false;
}

function renderStats(liste) {
  const utfortIArListe = liste.filter((o) => o.status === "utfort" && erIDetteAret(o.utfortDato));
  const aktive = liste.filter((o) => o.status === "aktiv").length;
  const utfortIAr = utfortIArListe.length;
  // Ekte tall fra Recman sin jobApplication-scope (status "hired") når tilgjengelig -
  // faller tilbake til den gamle tilnærmingen (antallKandidater på mock-data) hvis ikke.
  const kandidaterLandet = kandidaterLandetIArEkte() ?? utfortIArListe.reduce((sum, o) => sum + (o.antallKandidater ?? 0), 0);

  statsRow.innerHTML = "";
  [
    { label: "Aktive", value: aktive, accent: "aktiv" },
    { label: "Utført i år", value: utfortIAr, accent: "utfort" },
    { label: "Kandidater Landet", value: kandidaterLandet }
  ].forEach(({ label, value, accent }) => {
    const el = document.createElement("div");
    el.className = accent ? `stat-card accent-${accent}` : "stat-card";
    el.innerHTML = `<span class="value">${value}</span><span class="label">${label}</span>`;
    statsRow.appendChild(el);
  });

  [
    { felt: "telefoner", label: "Antall telefoner", value: sisteTelling.telefoner },
    { felt: "moter", label: "Antall møter", value: sisteTelling.moter }
  ].forEach(({ felt, label, value }) => {
    const el = document.createElement("div");
    el.className = "stat-card stat-card-telling";
    el.dataset.felt = felt;
    el.innerHTML = `
      <button class="telling-btn telling-minus" data-delta="-1" aria-label="Trekk fra én">−</button>
      <span class="value">${value}</span>
      <span class="label">${label}</span>
      <button class="telling-btn telling-plus" data-delta="1" aria-label="Legg til én">+</button>
    `;
    statsRow.appendChild(el);
  });
}

// Manuell telling (telefoner/møter) - klikk +/- på kortet, lagres server-side
// (functions/api/telling.js) og nullstilles automatisk ved ny måned.
async function lastTelling() {
  sisteTelling = await hentTelling();
  renderStats(alleOppdrag);
}

function bindTelling() {
  statsRow.addEventListener("click", async (e) => {
    const knapp = e.target.closest(".telling-btn");
    if (!knapp) return;
    const kort = knapp.closest(".stat-card-telling");
    const felt = kort?.dataset.felt;
    const delta = Number(knapp.dataset.delta);
    if (!felt || !delta) return;
    const resultat = await oppdaterTelling(felt, delta);
    if (resultat) {
      sisteTelling = resultat;
      renderStats(alleOppdrag);
    }
  });
}

function renderLanes(liste) {
  const grupper = grupperPerAnsvarlig(liste);
  const tetthet = tetthetForAntall(grupper.length);

  lanesEl.className = `lanes density-${tetthet}`;
  lanesEl.innerHTML = "";

  grupper.forEach(([navn, oppdragListe]) => {
    const lane = document.createElement("section");
    lane.className = "lane";

    const farge = fargeForNavn(navn);
    lane.innerHTML = `
      <div class="lane-header">
        <span class="avatar" style="background:${farge}">${initialer(navn)}</span>
        <span class="name">${escapeHtml(navn)}</span>
        <span class="lane-count">${oppdragListe.length}</span>
      </div>
      <div class="lane-body"></div>
    `;

    const body = lane.querySelector(".lane-body");
    if (oppdragListe.length === 0) {
      body.innerHTML = '<div class="lane-empty">Ingen aktive oppdrag</div>';
    } else {
      sorterForVisning(oppdragListe).forEach((o) => body.appendChild(byggKort(o)));
    }

    lanesEl.appendChild(lane);
  });
}

function tetthetForAntall(antallRadgivere) {
  if (antallRadgivere <= 6) return "cozy";
  if (antallRadgivere <= 14) return "compact";
  return "dense";
}

// Alle oppdrag skal vises uten skrolling. Etter at tavlen er tegnet, prøver vi
// stadig mer kompakte kort-skalaer til ingen rådgiver-kolonne flyter over.
const KORT_SKALA_NIVAER = ["", "card-scale-1", "card-scale-2", "card-scale-3", "card-scale-4"];

function tilpassKortStorrelseTilSkjerm() {
  for (const nivå of KORT_SKALA_NIVAER) {
    KORT_SKALA_NIVAER.forEach((n) => n && lanesEl.classList.remove(n));
    if (nivå) lanesEl.classList.add(nivå);
    if (!harOverflow()) return;
  }
  // Selv på tettest nivå er det ikke garantert plass til absolutt alt i ekstreme
  // tilfeller - da vinner "ingen skrolling" og resten klippes visuelt av overflow:hidden.
}

function harOverflow() {
  return [...lanesEl.querySelectorAll(".lane-body")].some((el) => el.scrollHeight > el.clientHeight + 1);
}

function grupperPerAnsvarlig(liste) {
  const map = new Map();
  liste.forEach((o) => {
    if (!map.has(o.ansvarlig)) map.set(o.ansvarlig, []);
    map.get(o.ansvarlig).push(o);
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "no"));
}

function sorterForVisning(liste) {
  return [...liste].sort((a, b) => {
    if (a.status !== b.status) return STATUS_PRIORITET[a.status] - STATUS_PRIORITET[b.status];
    if (a.status === "utfort") return new Date(b.utfortDato) - new Date(a.utfortDato);
    return a.tittel.localeCompare(b.tittel, "no");
  });
}

function byggKort(o) {
  const div = document.createElement("div");
  div.className = `card status-${o.status}`;
  div.innerHTML = `
    <div class="tittel">${escapeHtml(o.tittel)}</div>
    <div class="kunde">${escapeHtml(o.kunde)}</div>
    <div class="meta-row">
      <span class="status-pill status-${o.status}">${statusLabel(o.status)}</span>
      <span class="card-right">
        ${kortHoyreTekst(o)}
      </span>
    </div>
    ${fremdriftBarHtml(o)}
  `;
  return div;
}

function kortHoyreTekst(o) {
  if (o.status === "utfort") {
    return `<span class="frist">${utfortTekst(o.utfortDato)}</span>`;
  }
  if (typeof o.fremdriftProsent === "number") {
    return `<span class="fremdrift">${o.fremdriftProsent}%</span>`;
  }
  return "";
}

function fremdriftBarHtml(o) {
  if (o.status !== "aktiv" || typeof o.fremdriftProsent !== "number") return "";
  const prosent = Math.max(0, Math.min(100, o.fremdriftProsent));
  return `<div class="progress-bar"><div class="progress-bar-fill" style="width:${prosent}%"></div></div>`;
}

function utfortTekst(iso) {
  const dager = dagerSiden(iso);
  if (dager <= 0) return "Utført i dag";
  if (dager === 1) return "Utført i går";
  return `Utført for ${dager} dager siden`;
}

function statusLabel(status) {
  return { aktiv: "Aktiv", utfort: "Utført" }[status] ?? status;
}

function dagerSiden(iso) {
  if (!iso) return Infinity;
  return Math.floor((new Date() - new Date(iso)) / 86400000);
}

function erIDetteAret(iso) {
  if (!iso) return false;
  return new Date(iso).getFullYear() === new Date().getFullYear();
}

function initialer(navn) {
  return navn
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((del) => del[0].toUpperCase())
    .join("");
}

function fargeForNavn(navn) {
  let hash = 0;
  for (let i = 0; i < navn.length; i++) {
    hash = (hash * 31 + navn.charCodeAt(i)) % PALETTE_SIZE;
  }
  return `var(--palette-${hash + 1})`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
