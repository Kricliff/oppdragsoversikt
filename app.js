const AUTO_REFRESH_MS = 5 * 60 * 1000; // skjermen skal stå ubetjent, så data friskes opp selv
const UTFORT_SYNLIG_DAGER = 7; // et "Utført"-oppdrag blir stående på tavlen i 7 dager før det forsvinner
const PA_VENT_SYNLIG_DAGER = 7; // et "På vent"-oppdrag blir stående på tavlen i 7 dager før det forsvinner
const PALETTE_SIZE = 8;
const STATUS_PRIORITET = { aktiv: 0, paVent: 1, utfort: 2 };
const BUSS_REFRESH_MS = 30 * 1000; // sanntid - friskes opp oftere enn oppdrag
const BUSS_TIKK_MS = 15 * 1000; // tikker ned "om X min" mellom hver reell henting
const PANEL_BYTT_MS = 6 * 1000; // veksler mellom visningene i samme panel
const PANEL_REKKEFOLGE = ["buss", "togOslo", "togDrammen", "trikk", "tbaneVest", "tbaneOst"];
const DEPLOY_SJEKK_MS = 2 * 60 * 1000; // skjermen kjører ubetjent - må selv oppdage nye deploys
const DEPLOY_SJEKK_FILER = ["/index.html", "/style.css", "/app.js", "/busstider.js", "/recman-adapter.js", "/telling.js", "/vaer.js", "/feiring.js", "/nrk.js", "/kundenytt.js"];
const TELLING_REFRESH_MS = 5 * 60 * 1000; // matcher cache-tiden i functions/api/telling.js
const VAER_REFRESH_MS = 30 * 60 * 1000; // matcher cache-tiden i functions/api/vaer.js
const FEIRING_REFRESH_MS = 60 * 1000; // hent fasiten fra serveren hvert minutt
const FEIRING_TIKK_MS = 60 * 1000; // tikker ned lokalt mellom hver reelle henting
const NRK_REFRESH_MS = 10 * 60 * 1000; // matcher cache-tiden i functions/api/nrk.js
const KUNDENYTT_REFRESH_MS = 10 * 60 * 1000; // matcher cache-tiden i functions/api/kundenytt.js
const KUNDENYTT_KAROUSELL_MS = 10 * 1000; // bytter til neste sak hvert 10. sekund

let alleOppdrag = [];
let sisteAvganger = [];
let sisteTog = { motDrammen: [], motOslo: [] };
let sisteTrikk = [];
let sisteTbane = { vestover: [], ostover: [] };
let visPanel = "buss"; // buss | togOslo | togDrammen | trikk | tbaneVest | tbaneOst
let sisteTelling = { telefoner: 0, moter: 0 };
let sisteKodeInnhold = null;
let feiringAktive = []; // [{ tekst, utloper }] - speiler serverens svar direkte, se lastFeiring
let nrkOverskrifter = []; // [{ tittel, logo }] - vises i banneret når det ikke er noen aktive feiringer
let sisteBannerTekst = null; // for å vite når rulleteksten faktisk har endret seg, se restartFeiringAnimasjon
let kundenytt = []; // omtale av kunder i nyhetene, se lastKundenytt
let kundenyttIndeks = 0; // hvilken sak som vises nå i karusellen
let sisteBusstiderOppdatert = null; // tidspunkt for siste vellykkede henting, vises i panel-header
let sisteKundenyttOppdatert = null;

const lanesEl = document.getElementById("lanes");
const statsRow = document.getElementById("statsRow");
const sourceBadge = document.getElementById("sourceBadge");
const updatedLabel = document.getElementById("updatedLabel");
const emptyState = document.getElementById("emptyState");
const clockEl = document.getElementById("clock");
const dateLabelEl = document.getElementById("dateLabel");
const refreshBtn = document.getElementById("refreshBtn");
const temaBtn = document.getElementById("temaBtn");
const brandLogoEl = document.getElementById("brandLogo");
const notatEl = document.getElementById("notatTekst");
const busstiderHeaderEl = document.getElementById("busstiderHeader");
const busstiderListeEl = document.getElementById("busstiderListe");
const vaerIkonEl = document.getElementById("vaerIkon");
const vaerTempEl = document.getElementById("vaerTemp");
const vaerVarselEl = document.getElementById("vaerVarsel");
const feiringBannerEl = document.getElementById("feiringBanner");
const feiringTrackEl = document.getElementById("feiringTrack");
const feiringTekst1El = document.getElementById("feiringTekst1");
const feiringTekst2El = document.getElementById("feiringTekst2");
const kundenyttPanelEl = document.getElementById("kundenyttPanel");
const kundenyttHeaderEl = document.getElementById("kundenyttHeader");
const kundenyttListeEl = document.getElementById("kundenyttListe");
const gjestevisningEl = document.getElementById("gjestevisning");
const gjesteKnappEl = document.getElementById("gjesteKnapp");
const gjesteStatsEl = document.getElementById("gjesteStats");
const gjesteGrafKandidaterEl = document.getElementById("gjesteGrafKandidater");
const gjesteGrafOppdragEl = document.getElementById("gjesteGrafOppdrag");

async function init() {
  initTema();
  await lastTelling();
  await lastOppdrag();
  tikkKlokke();
  lastNotat();
  lastBusstider();
  lastVaer();
  setInterval(tikkKlokke, 1000);
  setInterval(lastOppdrag, AUTO_REFRESH_MS);
  setInterval(lastNotat, AUTO_REFRESH_MS);
  setInterval(lastBusstider, BUSS_REFRESH_MS);
  setInterval(renderTransportPanel, BUSS_TIKK_MS);
  setInterval(byttTransportPanel, PANEL_BYTT_MS);
  setInterval(lastTelling, TELLING_REFRESH_MS);
  setInterval(lastVaer, VAER_REFRESH_MS);
  lastFeiring();
  setInterval(lastFeiring, FEIRING_REFRESH_MS);
  lastNrk();
  setInterval(lastNrk, NRK_REFRESH_MS);
  lastKundenytt();
  setInterval(lastKundenytt, KUNDENYTT_REFRESH_MS);
  setInterval(rullKundenytt, KUNDENYTT_KAROUSELL_MS);
  setInterval(oppdaterFeiringVisning, FEIRING_TIKK_MS);
  sjekkNyVersjon();
  setInterval(sjekkNyVersjon, DEPLOY_SJEKK_MS);
  refreshBtn.addEventListener("click", () => lastOppdrag());
  temaBtn.addEventListener("click", byttTema);
  document.addEventListener("keydown", handterGjesteHotkey);
  gjesteKnappEl.addEventListener("click", veksleGjestevisning);
  // Knappen selv dekkes av gjestevisningen når den er aktiv (høyere z-index) - klikk
  // hvor som helst på den for å lukke igjen, i tillegg til Escape/hurtigtasten.
  gjestevisningEl.addEventListener("click", () => gjestevisningEl.classList.remove("vis"));
}

// Ctrl+Shift+G veksler gjestevisningen av og på - Escape lukker den. Skjuler alt av
// kandidat-/kundenavn bak en enkel "hvordan går det med oss"-oversikt, til bruk når det
// kommer besøk. Ingen kroner/beløp vises noe sted - kun antall og trender.
function handterGjesteHotkey(e) {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "g") {
    e.preventDefault();
    veksleGjestevisning();
  } else if (e.key === "Escape" && gjestevisningEl.classList.contains("vis")) {
    gjestevisningEl.classList.remove("vis");
  }
}

function veksleGjestevisning() {
  gjestevisningEl.hidden = false;
  const visesNa = gjestevisningEl.classList.toggle("vis");
  if (visesNa) renderGjestevisning();
}

function renderGjestevisning() {
  const aktive = alleOppdrag.filter((o) => o.status === "aktiv");
  const fullforteIAr = alleOppdrag.filter((o) => o.status === "utfort" && erIDetteAret(o.utfortDato));
  const unikeKunder = new Set(aktive.map((o) => o.kunde)).size;

  const kandidaterIAr = kandidaterLandetIArEkte();
  const kandidatSammenligning = lagSammenligning(kandidaterIAr, kandidaterLandetIFjorEkte());
  const gjentakendeProsent = beregnGjentakendeKundeandel(alleOppdrag);

  // Merk: dagerTilAnsettelseSnittEkte() (snitt dager fra oppstart til ansettelse) regnes
  // ut, men vises bevisst IKKE her - vårt reelle tall lå langt over det offentlig kjente
  // bransjesnittet (32-44 dager) da dette ble bygget, og en direkte sammenligning ville da
  // virke mot sin hensikt i en gjestevisning. Tallet er fortsatt tilgjengelig internt.
  gjesteStatsEl.replaceChildren(
    lagGjesteStat(aktive.length, "Aktive oppdrag"),
    lagGjesteStat(kandidaterIAr ?? "–", "Kandidater landet i år", kandidatSammenligning),
    lagGjesteStat(fullforteIAr.length, "Oppdrag fullført i år"),
    lagGjesteStat(kandidaterLandetTotaltEkte() ?? "–", "Kandidater landet totalt"),
    lagGjesteStat(unikeKunder, "Kunder vi jobber med nå"),
    lagGjesteStat(gjentakendeProsent != null ? `${gjentakendeProsent}%` : "–", "Kunder som kommer tilbake")
  );

  tegnGjesteGraf(gjesteGrafKandidaterEl, kandidaterLandetPerManedEkte());
  tegnGjesteGraf(gjesteGrafOppdragEl, fullforteOppdragPerManed(fullforteIAr));
}

// Andel av kundene vi har hatt oppdrag for (aktiv/utført/på vent) som har hatt mer enn
// ett oppdrag hos oss - et ærlig lojalitetsmål som ikke krever data om andre byråer for
// å være overbevisende i seg selv.
function beregnGjentakendeKundeandel(liste) {
  const oppdragPerKunde = new Map();
  liste.forEach((o) => {
    if (!o.kunde) return;
    oppdragPerKunde.set(o.kunde, (oppdragPerKunde.get(o.kunde) ?? 0) + 1);
  });
  if (oppdragPerKunde.size === 0) return null;
  const gjentakende = [...oppdragPerKunde.values()].filter((antall) => antall > 1).length;
  return Math.round((gjentakende / oppdragPerKunde.size) * 100);
}

function lagSammenligning(iAr, iFjor) {
  if (typeof iAr !== "number" || typeof iFjor !== "number" || iFjor === 0) return null;
  const endring = Math.round(((iAr - iFjor) / iFjor) * 100);
  return { retning: endring >= 0 ? "opp" : "ned", tekst: `${endring >= 0 ? "↑" : "↓"} ${Math.abs(endring)}% fra i fjor` };
}

function lagGjesteStat(verdi, etikett, sammenligning, notat) {
  const div = document.createElement("div");
  div.className = "gjeste-stat";

  const verdiEl = document.createElement("div");
  verdiEl.className = "verdi";
  verdiEl.textContent = verdi;
  div.appendChild(verdiEl);

  const etikettEl = document.createElement("div");
  etikettEl.className = "etikett";
  etikettEl.textContent = etikett;
  div.appendChild(etikettEl);

  if (sammenligning) {
    const sammenligningEl = document.createElement("div");
    sammenligningEl.className = `sammenligning ${sammenligning.retning}`;
    sammenligningEl.textContent = sammenligning.tekst;
    div.appendChild(sammenligningEl);
  }

  if (notat) {
    const notatEl = document.createElement("div");
    notatEl.className = "gjeste-stat-notat";
    notatEl.textContent = notat;
    div.appendChild(notatEl);
  }

  return div;
}

// Samme månedsfordeling som kandidaterLandetPerManedEkte(), men for fullførte oppdrag -
// utledet lokalt av alleOppdrag (ingen egen API-henting nødvendig, dataen er alt hentet).
function fullforteOppdragPerManed(fullforteIAr) {
  const naa = new Date();
  const perManed = [];
  for (let m = 0; m <= naa.getMonth(); m++) {
    perManed.push({ maned: m, antall: fullforteIAr.filter((o) => o.utfortDato && new Date(o.utfortDato).getMonth() === m).length });
  }
  return perManed;
}

const GJESTE_MANEDSNAVN = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

function tegnGjesteGraf(containerEl, data) {
  if (!data || data.length === 0) {
    containerEl.innerHTML = '<p class="endring-tom">Ingen data ennå</p>';
    return;
  }

  const maks = Math.max(1, ...data.map((d) => d.antall));
  containerEl.replaceChildren(
    ...data.map((d) => {
      const soyle = document.createElement("div");
      soyle.className = "gjeste-graf-soyle";

      const tall = document.createElement("span");
      tall.className = "gjeste-graf-tall";
      tall.textContent = d.antall;
      soyle.appendChild(tall);

      const track = document.createElement("div");
      track.className = "gjeste-graf-track";
      const bar = document.createElement("div");
      bar.className = "gjeste-graf-bar";
      bar.style.height = `${Math.max(4, (d.antall / maks) * 100)}%`;
      track.appendChild(bar);
      soyle.appendChild(track);

      const etikett = document.createElement("span");
      etikett.className = "gjeste-graf-etikett";
      etikett.textContent = GJESTE_MANEDSNAVN[d.maned];
      soyle.appendChild(etikett);

      return soyle;
    })
  );
}

// Værmelding for Oslo (functions/api/vaer.js, ekte MET/Yr-data). Rent visuelt -
// feiler stille (viser bare placeholder-ikonet) om MET skulle være nede.
async function lastVaer() {
  const data = await hentVaer();
  if (!data) return;
  vaerIkonEl.textContent = vaerIkonForSymbol(data.symbolKode);
  vaerTempEl.textContent = `${data.temperatur}°`;
  vaerVarselEl.hidden = !data.taMedParaply;
}

// Feiring av kandidat landet / ny kunde / nytt oppdrag (functions/api/feiring.js) -
// serveren regner ut både tekst og resterende varighet, klienten speiler bare svaret.
// Det gjør at banneret overlever en sideoppdatering (F5, eller tavlens egen auto-reload)
// i stedet for å forsvinne fordi serveren kun leverer NYE hendelser én gang.
async function lastFeiring() {
  feiringAktive = await hentFeiring();
  oppdaterFeiringVisning();
}

// Siste toppsaker fra NRK og TV2 (functions/api/nrk.js) - fyller banneret nederst når
// det ikke er noen aktive feiringer der. Feiringer har alltid forrang over nyheter.
async function lastNrk() {
  nrkOverskrifter = await hentNrkNyheter();
  oppdaterFeiringVisning();
}

function harBannerInnhold() {
  return feiringAktive.length > 0 || nrkOverskrifter.length > 0;
}

function feiringChips() {
  if (feiringAktive.length > 0) {
    return feiringAktive.map((h) => ({ type: "feiring", tekst: h.tekst }));
  }
  return nrkOverskrifter.map((s) => ({ type: "nyhet", tekst: s.tittel, logo: s.logo }));
}

function oppdaterFeiringVisning() {
  const naa = Date.now();
  feiringAktive = feiringAktive.filter((h) => h.utloper > naa);

  if (!harBannerInnhold()) {
    feiringBannerEl.classList.remove("vis");
    setTimeout(() => {
      if (!harBannerInnhold()) feiringBannerEl.hidden = true;
    }, 500);
    sisteBannerTekst = null;
    return;
  }

  const chips = feiringChips();
  const signatur = chips.map((c) => `${c.type}:${c.tekst}`).join("|");

  feiringBannerEl.hidden = false;
  requestAnimationFrame(() => feiringBannerEl.classList.add("vis"));

  // Bytt innhold og start rullingen på nytt fra venstre kant kun når det faktisk
  // har endret seg - ellers hopper den til et vilkårlig sted midt i teksten hver gang
  // dette kjører (hvert minutt), siden CSS-animasjonen normalt bare fortsetter å løpe.
  if (signatur !== sisteBannerTekst) {
    settFeiringInnhold(feiringTekst1El, chips);
    settFeiringInnhold(feiringTekst2El, chips);
    restartFeiringAnimasjon();
    sisteBannerTekst = signatur;
  }
}

function settFeiringInnhold(containerEl, chips) {
  containerEl.replaceChildren(...chips.map(lagFeiringChip));
}

function lagFeiringChip(chip) {
  const span = document.createElement("span");
  span.className = chip.type === "nyhet" ? "feiring-item nyhet" : "feiring-item";
  if (chip.type === "nyhet" && chip.logo) {
    const logo = document.createElement("img");
    logo.className = "feiring-kilde-logo";
    logo.src = chip.logo;
    logo.alt = "";
    span.appendChild(logo);
  }
  span.appendChild(document.createTextNode(chip.tekst));
  return span;
}

function restartFeiringAnimasjon() {
  feiringTrackEl.style.animation = "none";
  void feiringTrackEl.offsetWidth; // tving reflow slik at "none" faktisk får effekt
  feiringTrackEl.style.animation = "";
}

// Omtale av kunder i nyhetene (functions/api/kundenytt.js) - eget panel ved siden av
// post-it-lappen, ikke i bunnbanneret. Sjelden mange nok saker til å liste opp flere
// samtidig, så panelet viser én sak av gangen og bytter til neste hvert 10. sekund.
async function lastKundenytt() {
  kundenytt = await hentKundenytt();
  if (kundenyttIndeks >= kundenytt.length) kundenyttIndeks = 0;
  sisteKundenyttOppdatert = Date.now();
  renderKundenytt();
}

function rullKundenytt() {
  if (kundenytt.length <= 1) return; // ingenting å bytte til
  kundenyttListeEl.classList.add("bytter");
  setTimeout(() => {
    kundenyttIndeks = (kundenyttIndeks + 1) % kundenytt.length;
    renderKundenytt();
    kundenyttListeEl.classList.remove("bytter");
  }, 300);
}

function renderKundenytt() {
  if (kundenytt.length === 0) {
    kundenyttPanelEl.classList.remove("vis");
    setTimeout(() => {
      if (kundenytt.length === 0) kundenyttPanelEl.hidden = true;
    }, 500);
    return;
  }

  kundenyttPanelEl.hidden = false;
  requestAnimationFrame(() => kundenyttPanelEl.classList.add("vis"));
  settPanelHeader(kundenyttHeaderEl, "📣 Kundenytt", sisteKundenyttOppdatert);

  const funn = kundenytt[kundenyttIndeks];
  const rad = document.createElement("div");
  rad.className = "kundenytt-rad";

  const selskap = document.createElement("div");
  selskap.className = "kundenytt-selskap";
  selskap.textContent = funn.selskap;
  rad.appendChild(selskap);

  const tittel = document.createElement("div");
  tittel.className = "kundenytt-tittel";
  tittel.textContent = funn.tittel;
  rad.appendChild(tittel);

  if (funn.kilde) {
    const kilde = document.createElement("div");
    kilde.className = "kundenytt-kilde";
    kilde.textContent = funn.kilde;
    rad.appendChild(kilde);
  }

  kundenyttListeEl.replaceChildren(rad);
}

// Ekte telefon-/salgsmøte-telling fra Recman sin logg (functions/api/telling.js) -
// rent lesende, ingen manuell input. Kalles på nytt etter lastOppdrag() via renderStats.
async function lastTelling() {
  sisteTelling = await hentTelling();
  renderStats(alleOppdrag);
}

// Manuell nattmodus - husker valget i localStorage slik at det består til neste
// gang noen laster tavlen (f.eks. etter en auto-reload fra sjekkNyVersjon).
const TEMA_LAGRET_NOKKEL = "oppdragsoversikt-tema";

function initTema() {
  const lagret = localStorage.getItem(TEMA_LAGRET_NOKKEL);
  settTema(lagret === "dark" ? "dark" : "light");
}

function byttTema() {
  const naavaerende = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  settTema(naavaerende === "dark" ? "light" : "dark");
}

function settTema(tema) {
  document.documentElement.dataset.theme = tema;
  temaBtn.textContent = tema === "dark" ? "☀️" : "🌙";
  brandLogoEl.src = tema === "dark" ? "assets/great-people-white-logo.png" : "assets/great-people-black-logo.png";
  localStorage.setItem(TEMA_LAGRET_NOKKEL, tema);
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

// Delt post-it-lapp - kun lesevisning her (functions/api/notat.js). Redigeres via
// /admin, ikke direkte på tavlen - se readonly-attributtet på selve textarea.
async function lastNotat() {
  try {
    const res = await fetch("/api/notat");
    if (!res.ok) return;
    const data = await res.json();
    notatEl.value = data.tekst ?? "";
  } catch (err) {
    console.warn("Fikk ikke hentet notat:", err);
  }
}

// Avganger fra begge holdeplassene ved kontoret (functions/api/avganger.js, ekte
// Entur/Ruter-sanntidsdata) - buss fra Wessels plass og tog fra Nasjonaltheatret.
// Panelet veksler visning mellom de to hvert PANEL_BYTT_MS (se byttTransportPanel).
// Data cachet lokalt slik at "om X min"-teksten kan tikke ned mellom hver reelle
// henting, uten å måtte spørre API-et hvert 15. sekund.
async function lastBusstider() {
  const data = await hentAvganger();
  sisteAvganger = data.avganger;
  sisteTog = data.tog ?? { motDrammen: [], motOslo: [] };
  sisteTrikk = data.trikk?.avganger ?? [];
  sisteTbane = data.tbane ?? { vestover: [], ostover: [] };
  sisteBusstiderOppdatert = Date.now();
  renderTransportPanel();
}

function byttTransportPanel() {
  const naavaerendeIndeks = PANEL_REKKEFOLGE.indexOf(visPanel);
  visPanel = PANEL_REKKEFOLGE[(naavaerendeIndeks + 1) % PANEL_REKKEFOLGE.length];
  renderTransportPanel();
}

function renderTransportPanel() {
  let tittel;
  if (visPanel === "buss") {
    tittel = "🚌 Wessels plass";
    renderAvgangsliste(sisteAvganger);
  } else if (visPanel === "togOslo") {
    tittel = "🚆 Nasjonalth. - mot Oslo";
    renderAvgangsliste(sisteTog.motOslo);
  } else if (visPanel === "togDrammen") {
    tittel = "🚆 Nasjonalth. - mot Drammen";
    renderAvgangsliste(sisteTog.motDrammen);
  } else if (visPanel === "trikk") {
    tittel = "🚊 Øvre Slottsgate";
    renderAvgangsliste(sisteTrikk);
  } else if (visPanel === "tbaneVest") {
    tittel = "🚇 Stortinget - vestover";
    renderAvgangsliste(sisteTbane.vestover);
  } else {
    tittel = "🚇 Stortinget - østover";
    renderAvgangsliste(sisteTbane.ostover);
  }
  settPanelHeader(busstiderHeaderEl, tittel, sisteBusstiderOppdatert);
}

// Viser når dataene i et panel sist faktisk ble hentet på nytt (ikke bare
// tegnet om), som en liten tillitsindikator - se sisteBusstiderOppdatert/
// sisteKundenyttOppdatert.
function settPanelHeader(headerEl, tittel, tidspunkt) {
  headerEl.textContent = "";
  const tittelEl = document.createElement("span");
  tittelEl.textContent = tittel;
  headerEl.appendChild(tittelEl);
  if (tidspunkt) {
    const tid = document.createElement("span");
    tid.className = "panel-oppdatert";
    tid.textContent = new Date(tidspunkt).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
    headerEl.appendChild(tid);
  }
}

function renderAvgangsliste(liste) {
  tegnAvgangsrader(liste.map((a) => ({ linje: a.linje, tekst: a.destinasjon, avgangstid: a.avgangstid })));
}

function tegnAvgangsrader(rader) {
  busstiderListeEl.innerHTML = "";
  if (rader.length === 0) {
    busstiderListeEl.innerHTML = '<div class="buss-tom">Ingen avganger akkurat nå</div>';
    return;
  }
  rader.forEach((a) => {
    const rad = document.createElement("div");
    rad.className = "buss-rad";
    rad.innerHTML = `
      <span class="buss-linje">${escapeHtml(a.linje)}</span>
      <span class="buss-destinasjon">${escapeHtml(a.tekst)}</span>
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
  clockEl.textContent = now.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
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
  if (o.status === "paVent") return dagerSiden(o.paVentDato) <= PA_VENT_SYNLIG_DAGER;
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
    { label: "Aktive Prosjekter", value: aktive, accent: "aktiv" },
    { label: "Utført i år", value: utfortIAr, accent: "utfort" },
    { label: "Kandidater Landet", value: kandidaterLandet },
    { label: "Telefoner", value: sisteTelling.telefoner },
    { label: "Salgsmøter", value: sisteTelling.moter }
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
    if (a.status === "paVent") return new Date(b.paVentDato) - new Date(a.paVentDato);
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
  if (o.status === "paVent") {
    return `<span class="frist">${paVentTekst(o.paVentDato)}</span>`;
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

// Motsatt av utfortTekst - viser nedtelling i stedet for hvor lenge siden, siden det
// som er relevant her er når oppdraget forsvinner, ikke når det ble satt på vent.
function paVentTekst(iso) {
  const dagerIgjen = PA_VENT_SYNLIG_DAGER - dagerSiden(iso);
  if (dagerIgjen <= 0) return "Forsvinner snart";
  if (dagerIgjen === 1) return "Forsvinner om 1 dag";
  return `Forsvinner om ${dagerIgjen} dager`;
}

function statusLabel(status) {
  return { aktiv: "Aktiv", utfort: "Utført", paVent: "På vent" }[status] ?? status;
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
