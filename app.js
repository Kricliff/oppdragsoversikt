const AUTO_REFRESH_MS = 5 * 60 * 1000; // skjermen skal stå ubetjent, så data friskes opp selv
const UTFORT_SYNLIG_DAGER = 7; // et "Utført"-oppdrag blir stående på tavlen i 7 dager før det forsvinner
// Rydder engangs-bort hele den daværende "Utført"-bunken på tavlen (28.08.2026) - alt som
// var fullført FØR dette tidspunktet vises ikke lenger, uansett hvor nytt det er. Kun
// oppdrag som blir satt til utført ETTER dette dukker opp, og følger deretter den vanlige
// UTFORT_SYNLIG_DAGER-regelen som før.
const UTFORT_BASISDATO = new Date("2026-08-28T12:30:00Z");
const PA_VENT_SYNLIG_DAGER = 7; // et "På vent"-oppdrag blir stående på tavlen i 7 dager før det forsvinner
const PALETTE_SIZE = 8;
const STATUS_PRIORITET = { aktiv: 0, paVent: 1, utfort: 2 };
const BUSS_REFRESH_MS = 30 * 1000; // sanntid - friskes opp oftere enn oppdrag
const BUSS_TIKK_MS = 15 * 1000; // tikker ned "om X min" mellom hver reell henting
const PANEL_BYTT_MS = 6 * 1000; // veksler mellom visningene i samme panel
const PANEL_REKKEFOLGE = ["buss", "togOslo", "togDrammen", "trikk", "tbaneVest", "tbaneOst"];
const DEPLOY_SJEKK_MS = 2 * 60 * 1000; // skjermen kjører ubetjent - må selv oppdage nye deploys
const DEPLOY_SJEKK_FILER = ["/index.html", "/style.css", "/app.js", "/busstider.js", "/recman-adapter.js", "/telling.js", "/vaer.js", "/feiring.js", "/nrk.js", "/kundenytt.js", "/bursdager.js"];
const TELLING_REFRESH_MS = 5 * 60 * 1000; // matcher cache-tiden i functions/api/telling.js
const VAER_REFRESH_MS = 30 * 60 * 1000; // matcher cache-tiden i functions/api/vaer.js
const FEIRING_REFRESH_MS = 60 * 1000; // hent fasiten fra serveren hvert minutt
const FEIRING_TIKK_MS = 60 * 1000; // tikker ned lokalt mellom hver reelle henting
const NRK_REFRESH_MS = 10 * 60 * 1000; // matcher cache-tiden i functions/api/nrk.js
const KUNDENYTT_REFRESH_MS = 10 * 60 * 1000; // matcher cache-tiden i functions/api/kundenytt.js
const KUNDENYTT_KAROUSELL_MS = 10 * 1000; // bytter til neste sak hvert 10. sekund
const BURSDAG_REFRESH_MS = 10 * 60 * 1000; // bursdagslisten endrer seg sjelden
const TILBUD_REFRESH_MS = 20 * 60 * 1000; // matcher cache-tiden i functions/api/tilbud.js
const BURSDAG_VIS_MS = 20 * 1000; // hvor lenge feiringen midt på skjermen vises av gangen
const BURSDAG_SYKLUS_MS = 3 * 60 * 1000; // hvor ofte den dukker opp igjen på selve bursdagen
const SKJERM_ID_KEY = "skjermId";
const SKJERM_NAVN_KEY = "skjermNavn";
const SKJERM_HEARTBEAT_MS = 15 * 1000; // hvor ofte skjermen melder seg inn og sjekker for fjernstyring
const INNSTILLINGER_SJEKK_MS = 5 * 60 * 1000; // hvor ofte skjermen sjekker om en av/på-bryter i admin har endret seg

let alleOppdrag = [];
let innstillinger = { kundenytt: true, feiring: true, bursdager: true };
let sisteInnstillingerInnhold = null; // for å vite når en bryter faktisk har endret seg, se sjekkInnstillinger
let sisteAvganger = [];
let sisteTog = { motDrammen: [], motOslo: [] };
let sisteTrikk = [];
let sisteTbane = { vestover: [], ostover: [] };
let visPanel = "buss"; // buss | togOslo | togDrammen | trikk | tbaneVest | tbaneOst
let sisteTelling = { telefoner: 0, moter: 0 };
let sisteKodeInnhold = null;
let feiringAktive = []; // [{ tekst, utloper }] - speiler serverens svar direkte, se lastFeiring
let nrkOverskrifter = []; // [{ tittel, logo }] - vises i banneret når det ikke er noen aktive feiringer
let sisteBannerTekst = null; // for å vite når rulleteksten faktisk har endret seg, se restartRullebannerAnimasjon
let sisteNyheterTekst = null; // samme som over, men for den egne nyhetslinjen
let kundenytt = []; // omtale av kunder i nyhetene, se lastKundenytt
let kundenyttIndeks = 0; // hvilken sak som vises nå i karusellen
let sisteBusstiderOppdatert = null; // tidspunkt for siste vellykkede henting, vises i panel-header
let sisteKundenyttOppdatert = null;
let bursdager = []; // [{ navn, dato }] - lagt inn manuelt på /admin, se lastBursdager
let sisteSignerteTilbud = 0; // "Signerte tilbud denne mnd", se lastSignerteTilbud

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
const nyheterBannerEl = document.getElementById("nyheterBanner");
const nyheterTrackEl = document.getElementById("nyheterTrack");
const nyheterTekst1El = document.getElementById("nyheterTekst1");
const nyheterTekst2El = document.getElementById("nyheterTekst2");
const kundenyttPanelEl = document.getElementById("kundenyttPanel");
const kundenyttHeaderEl = document.getElementById("kundenyttHeader");
const kundenyttListeEl = document.getElementById("kundenyttListe");
const gjestevisningEl = document.getElementById("gjestevisning");
const gjesteKnappEl = document.getElementById("gjesteKnapp");
const gjesteStatsEl = document.getElementById("gjesteStats");
const gjesteGrafOppdragEl = document.getElementById("gjesteGrafOppdrag");
const gjesteTrenderListeEl = document.getElementById("gjesteTrenderListe");
const gjesteVaerIkonEl = document.getElementById("gjesteVaerIkon");
const gjesteVaerTempEl = document.getElementById("gjesteVaerTemp");
const gjesteVaerVarselEl = document.getElementById("gjesteVaerVarsel");
const gjesteKlokkeEl = document.getElementById("gjesteKlokke");
const gjesteDatoEl = document.getElementById("gjesteDato");
const gjesteVarselListeEl = document.getElementById("gjesteVarselListe");
const bursdagBannerEl = document.getElementById("bursdagBanner");
const bursdagBannerTrackEl = document.getElementById("bursdagBannerTrack");
const bursdagBannerTekst1El = document.getElementById("bursdagBannerTekst1");
const bursdagBannerTekst2El = document.getElementById("bursdagBannerTekst2");
const skjermNavngiEl = document.getElementById("skjermNavngi");
const skjermNavnInputEl = document.getElementById("skjermNavnInput");
const skjermNavnLagreKnappEl = document.getElementById("skjermNavnLagreKnapp");

async function init() {
  initTema();
  await lastInnstillinger();
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
  if (innstillinger.feiring) {
    lastFeiring();
    setInterval(lastFeiring, FEIRING_REFRESH_MS);
  }
  lastNrk();
  setInterval(lastNrk, NRK_REFRESH_MS);
  if (innstillinger.kundenytt) {
    lastKundenytt();
    setInterval(lastKundenytt, KUNDENYTT_REFRESH_MS);
    setInterval(rullKundenytt, KUNDENYTT_KAROUSELL_MS);
  }
  setInterval(oppdaterFeiringVisning, FEIRING_TIKK_MS);
  if (innstillinger.bursdager) {
    lastBursdager();
    setInterval(lastBursdager, BURSDAG_REFRESH_MS);
    setInterval(sjekkBursdagBanner, BURSDAG_SYKLUS_MS);
  }
  lastSignerteTilbud();
  setInterval(lastSignerteTilbud, TILBUD_REFRESH_MS);
  sjekkNyVersjon();
  setInterval(sjekkNyVersjon, DEPLOY_SJEKK_MS);
  setInterval(sjekkInnstillinger, INNSTILLINGER_SJEKK_MS);
  refreshBtn.addEventListener("click", () => lastOppdrag());
  temaBtn.addEventListener("click", byttTema);
  document.addEventListener("keydown", handterGjesteHotkey);
  gjesteKnappEl.addEventListener("click", veksleGjestevisning);
  // Knappen selv dekkes av gjestevisningen når den er aktiv (høyere z-index) - klikk
  // hvor som helst på den for å lukke igjen, i tillegg til Escape/hurtigtasten.
  gjestevisningEl.addEventListener("click", () => settGjestevisning(false));
  skjermNavnLagreKnappEl.addEventListener("click", lagreSkjermNavn);
  skjermNavnInputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") lagreSkjermNavn(); });
  startSkjermRegistrering();
}

// Ctrl+Shift+G veksler gjestevisningen av og på - Escape lukker den. Skjuler alt av
// kandidat-/kundenavn bak en enkel "hvordan går det med oss"-oversikt, til bruk når det
// kommer besøk. Ingen kroner/beløp vises noe sted - kun antall og trender.
function handterGjesteHotkey(e) {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "g") {
    e.preventDefault();
    veksleGjestevisning();
  } else if (e.key === "Escape" && gjestevisningEl.classList.contains("vis")) {
    settGjestevisning(false);
  }
}

function veksleGjestevisning() {
  settGjestevisning(!gjestevisningEl.classList.contains("vis"));
}

// Eneste sted som faktisk endrer om gjestevisningen vises - både lokale handlinger
// (hurtigtast/knapp/Escape/klikk) og fjernstyring fra en annen skjerm via admin går
// gjennom denne. Melder alltid den nye tilstanden til serveren (meldSkjermStatus), slik
// at admin sin oversikt og selve fjernstyringen alltid stemmer med det som faktisk vises.
function settGjestevisning(skalVises) {
  gjestevisningEl.hidden = false;
  gjestevisningEl.classList.toggle("vis", skalVises);
  if (skalVises) renderGjestevisning();
  meldSkjermStatus({ gjestevisning: skalVises, heartbeat: true });
}

// Fjernstyring fra admin-siden (functions/api/skjermer.js) - Cloudflare Access forteller
// bare HVEM som er logget inn, ikke HVILKEN fysisk skjerm, så hver skjerm får sin egen
// tilfeldige id lagret i localStorage (overlever innlasting på nytt, unik per enhet) og
// et navn brukeren setter én gang. Skjermen melder seg inn med jevne mellomrom og speiler
// tilbake ønsket gjestevisning-tilstand - se settGjestevisning over for hvordan lokale
// handlinger går gjennom samme kanal.
function hentEllerLagSkjermId() {
  let id = localStorage.getItem(SKJERM_ID_KEY);
  if (!id) {
    id = window.crypto?.randomUUID
      ? crypto.randomUUID()
      : `skjerm-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    localStorage.setItem(SKJERM_ID_KEY, id);
  }
  return id;
}

function startSkjermRegistrering() {
  if (!localStorage.getItem(SKJERM_NAVN_KEY)) {
    skjermNavngiEl.hidden = false;
    skjermNavnInputEl.focus();
    return;
  }
  meldSkjermStatus({ heartbeat: true });
  setInterval(() => meldSkjermStatus({ heartbeat: true }), SKJERM_HEARTBEAT_MS);
}

function lagreSkjermNavn() {
  const navn = skjermNavnInputEl.value.trim();
  if (!navn) return;
  localStorage.setItem(SKJERM_NAVN_KEY, navn);
  skjermNavngiEl.hidden = true;
  meldSkjermStatus({ heartbeat: true });
  setInterval(() => meldSkjermStatus({ heartbeat: true }), SKJERM_HEARTBEAT_MS);
}

async function meldSkjermStatus(ekstra) {
  const navn = localStorage.getItem(SKJERM_NAVN_KEY);
  if (!navn) return; // ikke meld seg inn før skjermen faktisk har fått et navn

  try {
    const res = await fetch("/api/skjermer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: hentEllerLagSkjermId(), navn, ...ekstra })
    });
    const data = await res.json();
    const visesNa = gjestevisningEl.classList.contains("vis");
    if (typeof data.gjestevisning === "boolean" && data.gjestevisning !== visesNa) {
      gjestevisningEl.hidden = false;
      gjestevisningEl.classList.toggle("vis", data.gjestevisning);
      if (data.gjestevisning) renderGjestevisning();
    }
  } catch (err) {
    console.warn("Fikk ikke meldt inn skjermstatus:", err);
  }
}

function renderGjestevisning() {
  const aktive = alleOppdrag.filter((o) => o.status === "aktiv");
  const fullforteIAr = alleOppdrag.filter((o) => o.status === "utfort" && erIDetteAret(o.utfortDato));
  const unikeKunder = new Set(aktive.map((o) => o.kunde)).size;

  gjesteStatsEl.replaceChildren(
    lagGjesteStat(aktive.length, "Aktive oppdrag"),
    lagGjesteStat(fullforteIAr.length, "Oppdrag fullført i år"),
    lagGjesteStat(unikeKunder, "Kunder vi jobber med nå")
  );

  tegnGjesteGraf(gjesteGrafOppdragEl, fullforteOppdragPerManed(fullforteIAr));
  renderGjesteTrender();
}

function lagGjesteStat(verdi, etikett) {
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

  return div;
}

// Månedsfordeling for fullførte oppdrag - utledet lokalt av alleOppdrag (ingen egen
// API-henting nødvendig, dataen er alt hentet).
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

// Kuraterte rekrutteringstrender - research 27.08.2026 (se kildehenvisninger i
// commit-meldingen). Statisk innhold, ikke hentet live fra noe API - bør oppdateres med
// jevne mellomrom etter hvert som ny bransjestatistikk kommer, ikke satt opp til å friskes
// opp automatisk siden dette er generell bransjekunnskap, ikke våre egne tall.
const GJESTE_TRENDER = [
  { tall: "88%", tekst: "av selskaper bruker nå AI i tidlig kandidatscreening" },
  { tall: "70%", tekst: "av virksomheter har gått over til kompetansebasert rekruttering" },
  { tall: "45%", tekst: "av arbeidsgivere sliter med å finne rett kompetanse" },
  { tall: "2×", tekst: "flere søknader per stilling siden 2022 - men fortsatt vanskeligere å fylle dem" }
];

function renderGjesteTrender() {
  gjesteTrenderListeEl.replaceChildren(
    ...GJESTE_TRENDER.map((t) => {
      const div = document.createElement("div");
      div.className = "gjeste-trend";

      const tallEl = document.createElement("div");
      tallEl.className = "tall";
      tallEl.textContent = t.tall;
      div.appendChild(tallEl);

      const tekstEl = document.createElement("div");
      tekstEl.className = "tekst";
      tekstEl.textContent = t.tekst;
      div.appendChild(tekstEl);

      return div;
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

  // Gjestevisningen har sin egen kopi av vær/klokke/dato-widgeten, siden hovedtavlens
  // ligger inni <header> som er skjult mens gjestevisningen vises over den.
  gjesteVaerIkonEl.textContent = vaerIkonEl.textContent;
  gjesteVaerTempEl.textContent = vaerTempEl.textContent;
  gjesteVaerVarselEl.hidden = vaerVarselEl.hidden;

  gjesteVarselListeEl.replaceChildren(
    ...(data.varsel3dager ?? []).map((dag) => {
      const div = document.createElement("div");
      div.className = "gjeste-varsel-dag";

      const ukedagEl = document.createElement("div");
      ukedagEl.className = "ukedag";
      ukedagEl.textContent = dag.ukedag;
      div.appendChild(ukedagEl);

      const ikonEl = document.createElement("div");
      ikonEl.className = "ikon";
      ikonEl.textContent = vaerIkonForSymbol(dag.symbolKode);
      div.appendChild(ikonEl);

      const tempEl = document.createElement("div");
      tempEl.className = "temp";
      tempEl.textContent = `${dag.maks}° / ${dag.min}°`;
      div.appendChild(tempEl);

      return div;
    })
  );
}

// Feiring av kandidat landet / ny kunde / nytt oppdrag (functions/api/feiring.js) -
// serveren regner ut både tekst og resterende varighet, klienten speiler bare svaret.
// Det gjør at banneret overlever en sideoppdatering (F5, eller tavlens egen auto-reload)
// i stedet for å forsvinne fordi serveren kun leverer NYE hendelser én gang.
//
// Egen linje, stablet over nyhetslinjen (se lastNrk/oppdaterNyheterVisning under) -
// de to vises uavhengig av hverandre, ikke som fallback for hverandre lenger.
async function lastFeiring() {
  feiringAktive = await hentFeiring();
  oppdaterFeiringVisning();
}

function oppdaterFeiringVisning() {
  const naa = Date.now();
  feiringAktive = feiringAktive.filter((h) => h.utloper > naa);

  if (feiringAktive.length === 0) {
    feiringBannerEl.classList.remove("vis");
    setTimeout(() => {
      if (feiringAktive.length === 0) feiringBannerEl.hidden = true;
    }, 500);
    sisteBannerTekst = null;
    return;
  }

  const signatur = feiringAktive.map((h) => h.tekst).join("|");

  feiringBannerEl.hidden = false;
  requestAnimationFrame(() => feiringBannerEl.classList.add("vis"));

  // Bytt innhold og start rullingen på nytt fra venstre kant kun når det faktisk
  // har endret seg - ellers hopper den til et vilkårlig sted midt i teksten hver gang
  // dette kjører (hvert minutt), siden CSS-animasjonen normalt bare fortsetter å løpe.
  if (signatur !== sisteBannerTekst) {
    settRullebannerInnhold(feiringTekst1El, feiringAktive.map((h) => h.tekst), "feiring-item");
    settRullebannerInnhold(feiringTekst2El, feiringAktive.map((h) => h.tekst), "feiring-item");
    restartRullebannerAnimasjon(feiringTrackEl);
    sisteBannerTekst = signatur;
  }
}

// Siste toppsaker fra NRK og TV2 (functions/api/nrk.js) - egen linje nederst, under
// feiringslinjen. Vises uavhengig av om det er noen aktive feiringer eller ikke.
async function lastNrk() {
  nrkOverskrifter = await hentNrkNyheter();
  oppdaterNyheterVisning();
}

function oppdaterNyheterVisning() {
  if (nrkOverskrifter.length === 0) {
    nyheterBannerEl.classList.remove("vis");
    setTimeout(() => {
      if (nrkOverskrifter.length === 0) nyheterBannerEl.hidden = true;
    }, 500);
    sisteNyheterTekst = null;
    return;
  }

  const signatur = nrkOverskrifter.map((s) => s.tittel).join("|");

  nyheterBannerEl.hidden = false;
  requestAnimationFrame(() => nyheterBannerEl.classList.add("vis"));

  if (signatur !== sisteNyheterTekst) {
    settRullebannerInnhold(nyheterTekst1El, nrkOverskrifter, "nyheter-item", "nyheter-kilde-logo");
    settRullebannerInnhold(nyheterTekst2El, nrkOverskrifter, "nyheter-item", "nyheter-kilde-logo");
    restartRullebannerAnimasjon(nyheterTrackEl);
    sisteNyheterTekst = signatur;
  }
}

// Delt av begge bannerlinjene - tar enten en liste med rene tekststrenger (feiring)
// eller {tittel, logo}-objekter (nyheter, se hentNrkNyheter).
function settRullebannerInnhold(containerEl, elementer, itemClass, logoClass) {
  containerEl.replaceChildren(
    ...elementer.map((e) => {
      const span = document.createElement("span");
      span.className = itemClass;
      if (logoClass && e.logo) {
        const logo = document.createElement("img");
        logo.className = logoClass;
        logo.src = e.logo;
        logo.alt = "";
        span.appendChild(logo);
      }
      span.appendChild(document.createTextNode(logoClass ? e.tittel : e));
      return span;
    })
  );
}

function restartRullebannerAnimasjon(trackEl) {
  trackEl.style.animation = "none";
  void trackEl.offsetWidth; // tving reflow slik at "none" faktisk får effekt
  trackEl.style.animation = "";
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

// Av/på-bryterne for kundenytt/feiring/bursdager settes fra admin (functions/api/
// innstillinger.js) og avgjør ved oppstart hvilke setInterval-løkker som i det hele
// tatt startes (se init) - feiler henting, kjører alt som normalt (alt på er standard).
async function lastInnstillinger() {
  try {
    const res = await fetch("/api/innstillinger");
    const data = await res.json();
    innstillinger = { ...innstillinger, ...data };
  } catch (err) {
    console.warn("Fikk ikke hentet innstillinger, bruker standardverdier (alt på):", err);
  }
}

// Skjermen står ubetjent, så en endret bryter i admin må oppdages av seg selv - samme
// "sjekk og last siden på nytt ved endring"-mønster som sjekkNyVersjon over, siden det
// er en enkel og allerede utprøvd måte å få de riktige setInterval-løkkene til å starte/
// stoppe på, uten å bygge egen live av/på-logikk for hver enkelt funksjon.
async function sjekkInnstillinger() {
  try {
    const res = await fetch("/api/innstillinger", { cache: "no-store" });
    const tekst = await res.text();
    if (sisteInnstillingerInnhold === null) {
      sisteInnstillingerInnhold = tekst;
      return;
    }
    if (tekst !== sisteInnstillingerInnhold) {
      location.reload();
    }
  } catch (err) {
    console.warn("Fikk ikke sjekket innstillinger:", err);
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
  gjesteKlokkeEl.textContent = clockEl.textContent;
  gjesteDatoEl.textContent = dateLabelEl.textContent;
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
  if (o.status === "utfort") {
    return new Date(o.utfortDato) > UTFORT_BASISDATO && dagerSiden(o.utfortDato) <= UTFORT_SYNLIG_DAGER;
  }
  if (o.status === "paVent") return dagerSiden(o.paVentDato) <= PA_VENT_SYNLIG_DAGER;
  return false;
}

function renderStats(liste) {
  const utfortIArListe = liste.filter((o) => o.status === "utfort" && erIDetteAret(o.utfortDato));
  const aktive = liste.filter((o) => o.status === "aktiv").length;
  const utfortIAr = utfortIArListe.length;

  statsRow.innerHTML = "";
  [
    { label: "Aktive Prosjekter", value: aktive, accent: "aktiv" },
    { label: "Utført i år", value: utfortIAr, accent: "utfort" },
    { label: "Signerte tilbud denne mnd", value: sisteSignerteTilbud },
    { label: "Telefoner", value: sisteTelling.telefoner },
    { label: "Salgsmøter", value: sisteTelling.moter }
  ].forEach(({ label, value, accent }) => {
    const el = document.createElement("div");
    el.className = accent ? `stat-card accent-${accent}` : "stat-card";
    el.innerHTML = `<span class="value">${value}</span><span class="label">${label}</span>`;
    statsRow.appendChild(el);
  });

  leggTilBursdagStat();
}

// Bursdager (lagt inn manuelt på /admin, functions/api/bursdager.js) - viser neste
// bursdag i statslinjen, og ruller en feiring midt på skjermen på selve dagen.
async function lastBursdager() {
  bursdager = await hentBursdager();
  renderStats(alleOppdrag); // statslinjen må friskes opp selv om ikke oppdragslisten har endret seg
  sjekkBursdagBanner();
}

// "Signerte tilbud denne mnd" (functions/api/tilbud.js) - se kommentar der for hvordan
// tallet faktisk regnes ut (RecMan eksponerer ikke selve tilbudsstatusen via API).
async function lastSignerteTilbud() {
  try {
    const res = await fetch("/api/tilbud");
    const data = await res.json();
    sisteSignerteTilbud = typeof data.signerteTilbud === "number" ? data.signerteTilbud : 0;
  } catch (err) {
    console.warn("Fikk ikke hentet signerte tilbud:", err);
  }
  renderStats(alleOppdrag);
}

function leggTilBursdagStat() {
  const neste = finnNesteBursdag(bursdager);
  if (!neste) return;

  const el = document.createElement("div");
  el.className = "stat-card bursdag";

  const value = document.createElement("span");
  value.className = "value";
  value.textContent = `🎂 ${formaterBursdagTekst(neste)}`;
  el.appendChild(value);

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Neste bursdag";
  el.appendChild(label);

  statsRow.appendChild(el);
}

// Finner personen(e) med nærmeste kommende bursdag - i dag teller som "0 dager til",
// bursdager som allerede har vært i år ruller over til neste år. Flere personer på
// samme dato vises sammen i stedet for at en tilfeldig én velges.
function finnNesteBursdag(liste) {
  if (!liste || liste.length === 0) return null;

  const naa = new Date();
  const iDag = new Date(naa.getFullYear(), naa.getMonth(), naa.getDate());

  let minDager = Infinity;
  let navn = [];
  let dato = null;

  liste.forEach((b) => {
    const [, mStr, dStr] = b.dato.split("-");
    const m = Number(mStr) - 1;
    const d = Number(dStr);
    let bursdagIAr = new Date(naa.getFullYear(), m, d);
    if (bursdagIAr < iDag) bursdagIAr = new Date(naa.getFullYear() + 1, m, d);

    const dagerTil = Math.round((bursdagIAr - iDag) / 86400000);
    if (dagerTil < minDager) {
      minDager = dagerTil;
      navn = [b.navn];
      dato = bursdagIAr;
    } else if (dagerTil === minDager) {
      navn.push(b.navn);
    }
  });

  return { navn, dato, dagerTil: minDager };
}

const BURSDAG_MANEDSNAVN = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

// Kun fornavn + forbokstaven i etternavnet (stor bokstav) på selve tavlen - fullt navn
// ligger fortsatt i admin. "Anne-Sophie Tvegård" -> "Anne-Sophie T.".
function formaterKortNavn(navn) {
  const deler = navn.trim().split(/\s+/);
  if (deler.length < 2) return deler[0] ?? navn;
  const fornavn = deler[0];
  const etternavn = deler[deler.length - 1];
  return `${fornavn} ${etternavn[0].toUpperCase()}.`;
}

function formaterBursdagTekst(neste) {
  const navnTekst = neste.navn.map(formaterKortNavn).join(" & ");
  if (neste.dagerTil === 0) return `${navnTekst} i dag!`;
  return `${navnTekst} (${neste.dato.getDate()}. ${BURSDAG_MANEDSNAVN[neste.dato.getMonth()]})`;
}

// Ruller en feiring midt på skjermen mens noen har bursdag i dag - vises i
// BURSDAG_VIS_MS av gangen, med BURSDAG_SYKLUS_MS mellom hver gang, i stedet for å
// stå fremme hele dagen og dekke innholdet bak.
function sjekkBursdagBanner() {
  const naa = new Date();
  const iDagNavn = bursdager
    .filter((b) => {
      const [, mStr, dStr] = b.dato.split("-");
      return Number(mStr) - 1 === naa.getMonth() && Number(dStr) === naa.getDate();
    })
    .map((b) => b.navn);

  if (iDagNavn.length === 0) {
    bursdagBannerEl.classList.remove("vis");
    return;
  }

  const samlet = iDagNavn
    .map((navn) => `🎉🎂 Gratulerer med dagen, ${formaterKortNavn(navn)}! 🎂🎉`)
    .join("　　");
  bursdagBannerTekst1El.textContent = samlet;
  bursdagBannerTekst2El.textContent = samlet;

  bursdagBannerEl.hidden = false;
  bursdagBannerTrackEl.style.animation = "none";
  void bursdagBannerTrackEl.offsetWidth; // tving reflow - start rullingen fra venstre kant hver gang
  bursdagBannerTrackEl.style.animation = "";
  requestAnimationFrame(() => bursdagBannerEl.classList.add("vis"));

  setTimeout(() => bursdagBannerEl.classList.remove("vis"), BURSDAG_VIS_MS);
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
    ${o.erNytt ? '<span class="ny-merke">Ny</span>' : ""}
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
