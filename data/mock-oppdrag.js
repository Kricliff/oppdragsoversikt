// Mock-data i samme form som recman-adapter.js forventer å motta fra Recman API.
// Byttes ut med et ekte API-kall når Recman-tilgang er på plass (se recman-adapter.js).
// Satt til et realistisk antall rådgivere for å teste tetthetsvisningen i app.js.
// Kun to statuser i bruk: "aktiv" og "utfort".
const MOCK_OPPDRAG = [
  { id: "opp-001", tittel: "Senior Utvikler", kunde: "Nordic Tech AS", ansvarlig: "Anna Berg", status: "aktiv", antallKandidater: 12, stadium: "screening" },
  { id: "opp-002", tittel: "HR-rådgiver", kunde: "Fjordkraft", ansvarlig: "Erik Solheim", status: "aktiv", antallKandidater: 5, stadium: "intervju" },
  { id: "opp-003", tittel: "Logistikkoordinator", kunde: "Bring", ansvarlig: "Anna Berg", status: "aktiv", antallKandidater: 3, stadium: "referanser" },
  { id: "opp-005", tittel: "Prosjektleder Bygg", kunde: "Veidekke", ansvarlig: "Erik Solheim", status: "aktiv", antallKandidater: 9, stadium: "tilbud" },
  { id: "opp-006", tittel: "Kundeservicemedarbeider", kunde: "Telenor", ansvarlig: "Mona Iversen", status: "aktiv", antallKandidater: 20, stadium: "screening" },
  { id: "opp-007", tittel: "Sykepleier, vikariat", kunde: "Oslo Kommune", ansvarlig: "Anna Berg", status: "aktiv", antallKandidater: 2, stadium: "intervju" },
  { id: "opp-008", tittel: "Butikkmedarbeider", kunde: "Rema 1000", ansvarlig: "Peder Nystad", status: "aktiv", antallKandidater: 15, stadium: "referanser" },
  { id: "opp-009", tittel: "Elektriker", kunde: "Elektro Sør AS", ansvarlig: "Peder Nystad", status: "aktiv", antallKandidater: 4, stadium: "tilbud" },
  { id: "opp-010", tittel: "Lagermedarbeider", kunde: "PostNord", ansvarlig: "Ingrid Haugen", status: "aktiv", antallKandidater: 7, stadium: "screening" },
  { id: "opp-011", tittel: "Renholder", kunde: "ISS Facility", ansvarlig: "Ingrid Haugen", status: "aktiv", antallKandidater: 1, stadium: "intervju" },
  { id: "opp-012", tittel: "Systemutvikler .NET", kunde: "Sbanken", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 6, stadium: "referanser" },
  { id: "opp-013", tittel: "Markedskoordinator", kunde: "Norgesgruppen", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 11, stadium: "tilbud" },
  { id: "opp-014", tittel: "Vernepleier", kunde: "Bærum Kommune", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 3, stadium: "screening" },
  { id: "opp-015", tittel: "Anleggsgartner", kunde: "Grønn Anlegg AS", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 2, stadium: "intervju" },
  { id: "opp-016", tittel: "Controller", kunde: "Yara", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 5, stadium: "referanser" },
  { id: "opp-017", tittel: "Driftstekniker", kunde: "Statkraft", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 4, stadium: "tilbud" },
  { id: "opp-018", tittel: "Tannlege", kunde: "Colosseum Tannlege", ansvarlig: "Silje Vik", status: "aktiv", antallKandidater: 2, stadium: "screening" },
  { id: "opp-019", tittel: "Lærer, 1.-7. trinn", kunde: "Oslo Kommune", ansvarlig: "Silje Vik", status: "aktiv", antallKandidater: 6, stadium: "intervju" },
  { id: "opp-020", tittel: "Kranfører", kunde: "AF Gruppen", ansvarlig: "Kristoffer Lund", status: "aktiv", antallKandidater: 3, stadium: "referanser" },
  { id: "opp-022", tittel: "Sikkerhetsvakt", kunde: "Securitas", ansvarlig: "Nina Dahl", status: "aktiv", antallKandidater: 14, stadium: "tilbud" },
  { id: "opp-023", tittel: "Resepsjonist", kunde: "Scandic Hotels", ansvarlig: "Nina Dahl", status: "aktiv", antallKandidater: 5, stadium: "screening" },
  { id: "opp-024", tittel: "Anleggsmaskinfører", kunde: "Skanska", ansvarlig: "Vegard Strand", status: "aktiv", antallKandidater: 2, stadium: "intervju" },
  { id: "opp-025", tittel: "Salgskonsulent", kunde: "Elkjøp", ansvarlig: "Vegard Strand", status: "aktiv", antallKandidater: 8, stadium: "referanser" },
  { id: "opp-026", tittel: "Byggeleder", kunde: "Backe Gruppen", ansvarlig: "Camilla Reme", status: "aktiv", antallKandidater: 4, stadium: "tilbud" },
  { id: "opp-027", tittel: "Fysioterapeut", kunde: "Aleris", ansvarlig: "Camilla Reme", status: "aktiv", antallKandidater: 3, stadium: "screening" },
  { id: "opp-028", tittel: "Truckfører", kunde: "Tine", ansvarlig: "Henrik Moe", status: "aktiv", antallKandidater: 1, stadium: "intervju" },
  { id: "opp-029", tittel: "Kokk", kunde: "Fursetgruppen", ansvarlig: "Henrik Moe", status: "aktiv", antallKandidater: 6, stadium: "referanser" },
  { id: "opp-030", tittel: "Nettverkstekniker", kunde: "Telia", ansvarlig: "Marte Sund", status: "aktiv", antallKandidater: 5, stadium: "tilbud" },

  // Eksempler på "utfort" - vises på tavlen i UTFORT_SYNLIG_DAGER (3) dager etter utfortDato, se app.js.
  // Statuslinjen i toppen teller derimot ALLE utfort-oppdrag med utfortDato i år (erIDetteAret i app.js),
  // så de eldre eksemplene under teller med i "Utført i år" selv om de ikke vises på tavlen lenger.
  { id: "opp-031", tittel: "Rørlegger", kunde: "Rørkjøp AS", ansvarlig: "Anna Berg", status: "utfort", antallKandidater: 4, utfortDato: "2026-08-24" },
  { id: "opp-032", tittel: "Selger, dagligvare", kunde: "Kiwi", ansvarlig: "Erik Solheim", status: "utfort", antallKandidater: 6, utfortDato: "2026-08-22" },
  { id: "opp-033", tittel: "Konsulent, økonomi", kunde: "DNB", ansvarlig: "Erik Solheim", status: "utfort", antallKandidater: 3, utfortDato: "2026-08-19" },
  { id: "opp-034", tittel: "Barnehagelærer", kunde: "Bergen Kommune", ansvarlig: "Mona Iversen", status: "utfort", antallKandidater: 5, utfortDato: "2026-02-10" },
  { id: "opp-035", tittel: "Servicetekniker", kunde: "Bosch", ansvarlig: "Peder Nystad", status: "utfort", antallKandidater: 3, utfortDato: "2026-04-03" },
  { id: "opp-036", tittel: "HMS-rådgiver", kunde: "Equinor", ansvarlig: "Thomas Aas", status: "utfort", antallKandidater: 7, utfortDato: "2026-06-18" }
];
