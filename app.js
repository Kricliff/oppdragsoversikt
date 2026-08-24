const AUTO_REFRESH_MS = 5 * 60 * 1000; // skjermen skal stå ubetjent, så data friskes opp selv
const FRIST_SOON_DAYS = 7;
const UTFORT_SYNLIG_DAGER = 3; // et "Utført"-oppdrag blir stående på tavlen i 3 dager før det forsvinner
const PALETTE_SIZE = 8;
const STATUS_PRIORITET = { aktiv: 0, utfort: 1 };

let alleOppdrag = [];

const lanesEl = document.getElementById("lanes");
const statsRow = document.getElementById("statsRow");
const sourceBadge = document.getElementById("sourceBadge");
const updatedLabel = document.getElementById("updatedLabel");
const emptyState = document.getElementById("emptyState");
const clockEl = document.getElementById("clock");
const dateLabelEl = document.getElementById("dateLabel");
const refreshBtn = document.getElementById("refreshBtn");

async function init() {
  await lastOppdrag();
  tikkKlokke();
  setInterval(tikkKlokke, 1000);
  setInterval(lastOppdrag, AUTO_REFRESH_MS);
  refreshBtn.addEventListener("click", () => lastOppdrag());
}

async function lastOppdrag() {
  refreshBtn.classList.add("spinning");
  try {
    alleOppdrag = await hentOppdrag();
    sourceBadge.textContent = RECMAN_CONFIG.enabled ? "Kilde: Recman" : "Kilde: mock-data";
    updatedLabel.textContent = `Sist oppdatert: ${new Date().toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })}`;
    render();
  } catch (err) {
    sourceBadge.textContent = "Feil ved lasting";
    console.error(err);
  } finally {
    setTimeout(() => refreshBtn.classList.remove("spinning"), 400);
  }
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
  const kandidaterLandet = utfortIArListe.reduce((sum, o) => sum + o.antallKandidater, 0);

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
}

function renderLanes(liste) {
  const grupper = grupperPerAnsvarlig(liste);
  const tetthet = tetthetForAntall(grupper.length);
  const maksKort = MAKS_KORT_PER_TETTHET[tetthet];

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
      const sortert = sorterForVisning(oppdragListe);
      const synlige = sortert.slice(0, maksKort);
      const rest = sortert.length - synlige.length;

      synlige.forEach((o) => body.appendChild(byggKort(o)));

      if (rest > 0) {
        const mer = document.createElement("div");
        mer.className = "lane-more";
        mer.textContent = `+${rest} flere`;
        body.appendChild(mer);
      }
    }

    lanesEl.appendChild(lane);
  });
}

function tetthetForAntall(antallRadgivere) {
  if (antallRadgivere <= 6) return "cozy";
  if (antallRadgivere <= 14) return "compact";
  return "dense";
}

const MAKS_KORT_PER_TETTHET = { cozy: 6, compact: 4, dense: 3 };

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
    return new Date(a.frist) - new Date(b.frist);
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
        <span class="kandidater">👤 ${o.antallKandidater}</span>
        ${kortHoyreTekst(o)}
      </span>
    </div>
  `;
  return div;
}

function kortHoyreTekst(o) {
  if (o.status === "utfort") {
    return `<span class="frist">${utfortTekst(o.utfortDato)}</span>`;
  }
  const frist = fristInfo(o.frist);
  return `<span class="frist ${frist.soon ? "soon" : ""}">${frist.tekst}</span>`;
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

function fristInfo(iso) {
  if (!iso) return { tekst: "-", soon: false };
  const frist = new Date(iso);
  const dagerIgjen = Math.ceil((frist - new Date()) / 86400000);
  const tekst = frist.toLocaleDateString("no-NO", { day: "numeric", month: "short" });
  return { tekst, soon: dagerIgjen <= FRIST_SOON_DAYS };
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
