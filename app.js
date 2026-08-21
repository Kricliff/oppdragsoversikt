let alleOppdrag = [];
let sortKolonne = "tittel";
let sortRetning = 1;

const tbody = document.getElementById("oppdragBody");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const ansvarligFilter = document.getElementById("ansvarligFilter");
const sourceBadge = document.getElementById("sourceBadge");
const statsRow = document.getElementById("statsRow");

async function init() {
  await lastOppdrag();
  bindEvents();
}

async function lastOppdrag() {
  sourceBadge.textContent = "Laster...";
  try {
    alleOppdrag = await hentOppdrag();
    sourceBadge.textContent = RECMAN_CONFIG.enabled ? "Kilde: Recman" : "Kilde: mock-data";
    fyllAnsvarligFilter();
    render();
  } catch (err) {
    sourceBadge.textContent = "Feil ved lasting";
    console.error(err);
  }
}

function fyllAnsvarligFilter() {
  const navn = [...new Set(alleOppdrag.map((o) => o.ansvarlig))].sort();
  ansvarligFilter.innerHTML = '<option value="alle">Alle ansvarlige</option>';
  navn.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n;
    ansvarligFilter.appendChild(opt);
  });
}

function bindEvents() {
  searchInput.addEventListener("input", render);
  statusFilter.addEventListener("change", render);
  ansvarligFilter.addEventListener("change", render);
  document.getElementById("refreshBtn").addEventListener("click", lastOppdrag);

  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const kol = th.dataset.sort;
      if (sortKolonne === kol) {
        sortRetning *= -1;
      } else {
        sortKolonne = kol;
        sortRetning = 1;
      }
      render();
    });
  });
}

function filtrerteOppdrag() {
  const q = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;
  const ansvarlig = ansvarligFilter.value;

  return alleOppdrag.filter((o) => {
    const matcherSok =
      !q ||
      o.tittel.toLowerCase().includes(q) ||
      o.kunde.toLowerCase().includes(q) ||
      o.ansvarlig.toLowerCase().includes(q);
    const matcherStatus = status === "alle" || o.status === status;
    const matcherAnsvarlig = ansvarlig === "alle" || o.ansvarlig === ansvarlig;
    return matcherSok && matcherStatus && matcherAnsvarlig;
  });
}

function sorterOppdrag(liste) {
  return [...liste].sort((a, b) => {
    const av = a[sortKolonne];
    const bv = b[sortKolonne];
    if (typeof av === "number") return (av - bv) * sortRetning;
    return String(av).localeCompare(String(bv), "no") * sortRetning;
  });
}

function render() {
  const filtrert = sorterOppdrag(filtrerteOppdrag());
  renderStats(filtrert);
  renderTabell(filtrert);
}

function renderStats(liste) {
  const totalt = liste.length;
  const aktive = liste.filter((o) => o.status === "aktiv").length;
  const kandidater = liste.reduce((sum, o) => sum + o.antallKandidater, 0);

  statsRow.innerHTML = "";
  [
    { label: "Oppdrag", value: totalt },
    { label: "Aktive", value: aktive },
    { label: "Kandidater totalt", value: kandidater }
  ].forEach(({ label, value }) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<div class="value">${value}</div><div class="label">${label}</div>`;
    statsRow.appendChild(card);
  });
}

function renderTabell(liste) {
  tbody.innerHTML = "";
  emptyState.hidden = liste.length > 0;

  liste.forEach((o) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(o.tittel)}</td>
      <td>${escapeHtml(o.kunde)}</td>
      <td>${escapeHtml(o.ansvarlig)}</td>
      <td><span class="status-pill status-${o.status}">${statusLabel(o.status)}</span></td>
      <td>${o.antallKandidater}</td>
      <td>${formatDato(o.frist)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function statusLabel(status) {
  return { aktiv: "Aktiv", pauset: "Pauset", avsluttet: "Avsluttet" }[status] ?? status;
}

function formatDato(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("no-NO", { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
