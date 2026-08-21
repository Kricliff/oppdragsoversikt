// Mock-data i samme form som recman-adapter.js forventer å motta fra Recman API.
// Byttes ut med et ekte API-kall når Recman-tilgang er på plass (se recman-adapter.js).
// Satt til et realistisk antall rådgivere for å teste tetthetsvisningen i app.js.
const MOCK_OPPDRAG = [
  { id: "opp-001", tittel: "Senior Utvikler", kunde: "Nordic Tech AS", ansvarlig: "Anna Berg", status: "aktiv", antallKandidater: 12, frist: "2026-09-15" },
  { id: "opp-002", tittel: "HR-rådgiver", kunde: "Fjordkraft", ansvarlig: "Erik Solheim", status: "aktiv", antallKandidater: 5, frist: "2026-09-01" },
  { id: "opp-003", tittel: "Logistikkoordinator", kunde: "Bring", ansvarlig: "Anna Berg", status: "pauset", antallKandidater: 3, frist: "2026-10-01" },
  { id: "opp-004", tittel: "Regnskapsfører", kunde: "Sparebank 1", ansvarlig: "Mona Iversen", status: "avsluttet", antallKandidater: 8, frist: "2026-07-30" },
  { id: "opp-005", tittel: "Prosjektleder Bygg", kunde: "Veidekke", ansvarlig: "Erik Solheim", status: "aktiv", antallKandidater: 9, frist: "2026-09-20" },
  { id: "opp-006", tittel: "Kundeservicemedarbeider", kunde: "Telenor", ansvarlig: "Mona Iversen", status: "aktiv", antallKandidater: 20, frist: "2026-08-31" },
  { id: "opp-007", tittel: "Sykepleier, vikariat", kunde: "Oslo Kommune", ansvarlig: "Anna Berg", status: "pauset", antallKandidater: 2, frist: "2026-11-01" },
  { id: "opp-008", tittel: "Butikkmedarbeider", kunde: "Rema 1000", ansvarlig: "Peder Nystad", status: "aktiv", antallKandidater: 15, frist: "2026-09-05" },
  { id: "opp-009", tittel: "Elektriker", kunde: "Elektro Sør AS", ansvarlig: "Peder Nystad", status: "aktiv", antallKandidater: 4, frist: "2026-09-10" },
  { id: "opp-010", tittel: "Lagermedarbeider", kunde: "PostNord", ansvarlig: "Ingrid Haugen", status: "aktiv", antallKandidater: 7, frist: "2026-08-28" },
  { id: "opp-011", tittel: "Renholder", kunde: "ISS Facility", ansvarlig: "Ingrid Haugen", status: "pauset", antallKandidater: 1, frist: "2026-10-15" },
  { id: "opp-012", tittel: "Systemutvikler .NET", kunde: "Sbanken", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 6, frist: "2026-09-12" },
  { id: "opp-013", tittel: "Markedskoordinator", kunde: "Norgesgruppen", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 11, frist: "2026-09-25" },
  { id: "opp-014", tittel: "Vernepleier", kunde: "Bærum Kommune", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 3, frist: "2026-08-29" },
  { id: "opp-015", tittel: "Anleggsgartner", kunde: "Grønn Anlegg AS", ansvarlig: "Thomas Aas", status: "pauset", antallKandidater: 2, frist: "2026-10-20" },
  { id: "opp-016", tittel: "Controller", kunde: "Yara", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 5, frist: "2026-09-18" },
  { id: "opp-017", tittel: "Driftstekniker", kunde: "Statkraft", ansvarlig: "Thomas Aas", status: "aktiv", antallKandidater: 4, frist: "2026-09-22" },
  { id: "opp-018", tittel: "Tannlege", kunde: "Colosseum Tannlege", ansvarlig: "Silje Vik", status: "aktiv", antallKandidater: 2, frist: "2026-09-08" },
  { id: "opp-019", tittel: "Lærer, 1.-7. trinn", kunde: "Oslo Kommune", ansvarlig: "Silje Vik", status: "aktiv", antallKandidater: 6, frist: "2026-08-30" },
  { id: "opp-020", tittel: "Kranfører", kunde: "AF Gruppen", ansvarlig: "Kristoffer Lund", status: "aktiv", antallKandidater: 3, frist: "2026-09-14" },
  { id: "opp-021", tittel: "Innkjøper", kunde: "Coop", ansvarlig: "Kristoffer Lund", status: "avsluttet", antallKandidater: 9, frist: "2026-07-15" },
  { id: "opp-022", tittel: "Sikkerhetsvakt", kunde: "Securitas", ansvarlig: "Nina Dahl", status: "aktiv", antallKandidater: 14, frist: "2026-09-03" },
  { id: "opp-023", tittel: "Resepsjonist", kunde: "Scandic Hotels", ansvarlig: "Nina Dahl", status: "pauset", antallKandidater: 5, frist: "2026-10-05" },
  { id: "opp-024", tittel: "Anleggsmaskinfører", kunde: "Skanska", ansvarlig: "Vegard Strand", status: "aktiv", antallKandidater: 2, frist: "2026-09-11" },
  { id: "opp-025", tittel: "Salgskonsulent", kunde: "Elkjøp", ansvarlig: "Vegard Strand", status: "aktiv", antallKandidater: 8, frist: "2026-09-06" },
  { id: "opp-026", tittel: "Byggeleder", kunde: "Backe Gruppen", ansvarlig: "Camilla Reme", status: "aktiv", antallKandidater: 4, frist: "2026-09-19" },
  { id: "opp-027", tittel: "Fysioterapeut", kunde: "Aleris", ansvarlig: "Camilla Reme", status: "aktiv", antallKandidater: 3, frist: "2026-08-27" },
  { id: "opp-028", tittel: "Truckfører", kunde: "Tine", ansvarlig: "Henrik Moe", status: "pauset", antallKandidater: 1, frist: "2026-10-10" },
  { id: "opp-029", tittel: "Kokk", kunde: "Fursetgruppen", ansvarlig: "Henrik Moe", status: "aktiv", antallKandidater: 6, frist: "2026-09-09" },
  { id: "opp-030", tittel: "Nettverkstekniker", kunde: "Telia", ansvarlig: "Marte Sund", status: "aktiv", antallKandidater: 5, frist: "2026-09-16" },

  // Eksempler på "utfort" - vises på tavlen i UTFORT_SYNLIG_DAGER (3) dager etter utfortDato, se app.js.
  { id: "opp-031", tittel: "Rørlegger", kunde: "Rørkjøp AS", ansvarlig: "Anna Berg", status: "utfort", antallKandidater: 4, utfortDato: "2026-08-21" },
  { id: "opp-032", tittel: "Selger, dagligvare", kunde: "Kiwi", ansvarlig: "Erik Solheim", status: "utfort", antallKandidater: 6, utfortDato: "2026-08-19" },
  { id: "opp-033", tittel: "Konsulent, økonomi", kunde: "DNB", ansvarlig: "Erik Solheim", status: "utfort", antallKandidater: 3, utfortDato: "2026-08-16" }
];
