// Mock-data i samme form som recman-adapter.js forventer å motta fra Recman API.
// Byttes ut med et ekte API-kall når Recman-tilgang er på plass (se recman-adapter.js).
// Kun to statuser i bruk: "aktiv" og "utfort". Recman sin "request"-fase ("På vent")
// vises bevisst ikke - se STATUS_MAP-kommentaren i functions/api/oppdrag.js.
//
// Rådgivernavnene er ekte (hentet fra Recman sitt "user"-scope 2026-08-24) - resten
// av innholdet (tittel/kunde/antallKandidater/fremdriftProsent) er fortsatt påfunnet,
// siden API-nøkkelen ennå ikke har lesetilgang til selve oppdragene ("job post"-scope).
const MOCK_OPPDRAG = [
  { id: "opp-001", tittel: "Senior Utvikler", kunde: "Nordic Tech AS", ansvarlig: "Kjetil Martinsen", status: "aktiv", antallKandidater: 12, fremdriftProsent: 15 },
  { id: "opp-002", tittel: "HR-rådgiver", kunde: "Fjordkraft", ansvarlig: "Christian Høie Lie", status: "aktiv", antallKandidater: 5, fremdriftProsent: 30 },
  { id: "opp-003", tittel: "Logistikkoordinator", kunde: "Bring", ansvarlig: "Kjetil Martinsen", status: "aktiv", antallKandidater: 3, fremdriftProsent: 45 },
  { id: "opp-005", tittel: "Prosjektleder Bygg", kunde: "Veidekke", ansvarlig: "Christian Høie Lie", status: "aktiv", antallKandidater: 9, fremdriftProsent: 60 },
  { id: "opp-006", tittel: "Kundeservicemedarbeider", kunde: "Telenor", ansvarlig: "Christer Kihlman", status: "aktiv", antallKandidater: 20, fremdriftProsent: 75 },
  { id: "opp-007", tittel: "Sykepleier, vikariat", kunde: "Oslo Kommune", ansvarlig: "Kjetil Martinsen", status: "aktiv", antallKandidater: 2, fremdriftProsent: 90 },
  { id: "opp-008", tittel: "Butikkmedarbeider", kunde: "Rema 1000", ansvarlig: "Anne-Sophie Tvegård", status: "aktiv", antallKandidater: 15, fremdriftProsent: 20 },
  { id: "opp-009", tittel: "Elektriker", kunde: "Elektro Sør AS", ansvarlig: "Anne-Sophie Tvegård", status: "aktiv", antallKandidater: 4, fremdriftProsent: 55 },
  { id: "opp-010", tittel: "Lagermedarbeider", kunde: "PostNord", ansvarlig: "Sara Göthe", status: "aktiv", antallKandidater: 7, fremdriftProsent: 15 },
  { id: "opp-011", tittel: "Renholder", kunde: "ISS Facility", ansvarlig: "Sara Göthe", status: "aktiv", antallKandidater: 1, fremdriftProsent: 30 },
  { id: "opp-012", tittel: "Systemutvikler .NET", kunde: "Sbanken", ansvarlig: "Christina Waale Salomaa", status: "aktiv", antallKandidater: 6, fremdriftProsent: 45 },
  { id: "opp-013", tittel: "Markedskoordinator", kunde: "Norgesgruppen", ansvarlig: "Christina Waale Salomaa", status: "aktiv", antallKandidater: 11, fremdriftProsent: 60 },
  { id: "opp-014", tittel: "Vernepleier", kunde: "Bærum Kommune", ansvarlig: "Christina Waale Salomaa", status: "aktiv", antallKandidater: 3, fremdriftProsent: 75 },
  { id: "opp-015", tittel: "Anleggsgartner", kunde: "Grønn Anlegg AS", ansvarlig: "Christina Waale Salomaa", status: "aktiv", antallKandidater: 2, fremdriftProsent: 90 },
  { id: "opp-016", tittel: "Controller", kunde: "Yara", ansvarlig: "Christina Waale Salomaa", status: "aktiv", antallKandidater: 5, fremdriftProsent: 20 },
  { id: "opp-017", tittel: "Driftstekniker", kunde: "Statkraft", ansvarlig: "Christina Waale Salomaa", status: "aktiv", antallKandidater: 4, fremdriftProsent: 55 },
  { id: "opp-018", tittel: "Tannlege", kunde: "Colosseum Tannlege", ansvarlig: "Geir Andersen", status: "aktiv", antallKandidater: 2, fremdriftProsent: 15 },
  { id: "opp-019", tittel: "Lærer, 1.-7. trinn", kunde: "Oslo Kommune", ansvarlig: "Geir Andersen", status: "aktiv", antallKandidater: 6, fremdriftProsent: 30 },
  { id: "opp-020", tittel: "Kranfører", kunde: "AF Gruppen", ansvarlig: "Fredrik Aaslestad", status: "aktiv", antallKandidater: 3, fremdriftProsent: 45 },
  { id: "opp-022", tittel: "Sikkerhetsvakt", kunde: "Securitas", ansvarlig: "Henrik Berg Klemmetsen", status: "aktiv", antallKandidater: 14, fremdriftProsent: 60 },
  { id: "opp-023", tittel: "Resepsjonist", kunde: "Scandic Hotels", ansvarlig: "Henrik Berg Klemmetsen", status: "aktiv", antallKandidater: 5, fremdriftProsent: 75 },
  { id: "opp-024", tittel: "Anleggsmaskinfører", kunde: "Skanska", ansvarlig: "Kristian Clifford", status: "aktiv", antallKandidater: 2, fremdriftProsent: 90 },
  { id: "opp-025", tittel: "Salgskonsulent", kunde: "Elkjøp", ansvarlig: "Kristian Clifford", status: "aktiv", antallKandidater: 8, fremdriftProsent: 20 },
  { id: "opp-026", tittel: "Byggeleder", kunde: "Backe Gruppen", ansvarlig: "Emelie Isosalo Jansson", status: "aktiv", antallKandidater: 4, fremdriftProsent: 55 },
  { id: "opp-027", tittel: "Fysioterapeut", kunde: "Aleris", ansvarlig: "Emelie Isosalo Jansson", status: "aktiv", antallKandidater: 3, fremdriftProsent: 15 },
  { id: "opp-028", tittel: "Truckfører", kunde: "Tine", ansvarlig: "Eivind Namløs", status: "aktiv", antallKandidater: 1, fremdriftProsent: 30 },
  { id: "opp-029", tittel: "Kokk", kunde: "Fursetgruppen", ansvarlig: "Eivind Namløs", status: "aktiv", antallKandidater: 6, fremdriftProsent: 45 },
  { id: "opp-030", tittel: "Nettverkstekniker", kunde: "Telia", ansvarlig: "Fredrik Hjortdal", status: "aktiv", antallKandidater: 5, fremdriftProsent: 60 },

  // Eksempler på "utfort" - vises på tavlen i UTFORT_SYNLIG_DAGER (7) dager etter utfortDato, se app.js.
  // Statuslinjen i toppen teller derimot ALLE utfort-oppdrag med utfortDato i år (erIDetteAret i app.js),
  // så de eldre eksemplene under teller med i "Utført i år" selv om de ikke vises på tavlen lenger.
  { id: "opp-031", tittel: "Rørlegger", kunde: "Rørkjøp AS", ansvarlig: "Kjetil Martinsen", status: "utfort", antallKandidater: 4, utfortDato: "2026-08-24" },
  { id: "opp-032", tittel: "Selger, dagligvare", kunde: "Kiwi", ansvarlig: "Christian Høie Lie", status: "utfort", antallKandidater: 6, utfortDato: "2026-08-22" },
  { id: "opp-033", tittel: "Konsulent, økonomi", kunde: "DNB", ansvarlig: "Christian Høie Lie", status: "utfort", antallKandidater: 3, utfortDato: "2026-08-19" },
  { id: "opp-034", tittel: "Barnehagelærer", kunde: "Bergen Kommune", ansvarlig: "Christer Kihlman", status: "utfort", antallKandidater: 5, utfortDato: "2026-02-10" },
  { id: "opp-035", tittel: "Servicetekniker", kunde: "Bosch", ansvarlig: "Anne-Sophie Tvegård", status: "utfort", antallKandidater: 3, utfortDato: "2026-04-03" },
  { id: "opp-036", tittel: "HMS-rådgiver", kunde: "Equinor", ansvarlig: "Christina Waale Salomaa", status: "utfort", antallKandidater: 7, utfortDato: "2026-06-18" }
];
