// Adapter mot Recman. I dag returneres mock-data; når Recman API-tilgang er klar,
// fylles RECMAN_CONFIG inn og fetchFromRecman() gjøres om til et ekte kall.
// Resten av appen (app.js) bryr seg ikke om kilden - den kaller bare hentOppdrag().

const RECMAN_CONFIG = {
  baseUrl: "", // f.eks. "https://api.recman.no/v1"
  apiKey: "",  // settes aldri i klientkode i produksjon - hentes via backend/proxy
  enabled: false
};

async function hentOppdrag() {
  if (RECMAN_CONFIG.enabled && RECMAN_CONFIG.baseUrl) {
    return fetchFromRecman();
  }
  return Promise.resolve(MOCK_OPPDRAG);
}

async function fetchFromRecman() {
  // Forventet respons fra Recman må mappes til samme felt-navn som MOCK_OPPDRAG:
  // id, tittel, kunde, ansvarlig, status, antallKandidater, utfortDato, stadium
  const res = await fetch(`${RECMAN_CONFIG.baseUrl}/oppdrag`, {
    headers: { Authorization: `Bearer ${RECMAN_CONFIG.apiKey}` }
  });
  if (!res.ok) {
    throw new Error(`Recman API-feil: ${res.status}`);
  }
  const data = await res.json();
  return mapRecmanRespons(data);
}

function mapRecmanRespons(recmanData) {
  // TODO: juster mapping når vi ser det faktiske Recman-responsformatet.
  // status må normaliseres til "aktiv" | "utfort" - alt annet vises ikke på tavlen (se app.js).
  // utfortDato er kun nødvendig når status er "utfort" - styrer hvor lenge
  // kortet vises på tavlen (se UTFORT_SYNLIG_DAGER i app.js).
  // stadium må normaliseres til "screening" | "intervju" | "referanser" | "tilbud"
  // (se STADIUM_LABELS i app.js) - vises kun for aktiv-oppdrag.
  return recmanData.map((r) => ({
    id: r.id,
    tittel: r.title ?? r.tittel,
    kunde: r.client?.name ?? r.kunde,
    ansvarlig: r.owner?.name ?? r.ansvarlig,
    status: r.status,
    antallKandidater: r.candidateCount ?? r.antallKandidater ?? 0,
    utfortDato: r.completedAt ?? r.utfortDato,
    stadium: r.stage ?? r.stadium
  }));
}
