// Mock-data i samme form som recman-adapter.js forventer å motta fra Recman API.
// Byttes ut med et ekte API-kall når Recman-tilgang er på plass (se recman-adapter.js).
const MOCK_OPPDRAG = [
  {
    id: "opp-001",
    tittel: "Senior Utvikler",
    kunde: "Nordic Tech AS",
    ansvarlig: "Anna Berg",
    status: "aktiv",
    antallKandidater: 12,
    frist: "2026-09-15"
  },
  {
    id: "opp-002",
    tittel: "HR-rådgiver",
    kunde: "Fjordkraft",
    ansvarlig: "Erik Solheim",
    status: "aktiv",
    antallKandidater: 5,
    frist: "2026-09-01"
  },
  {
    id: "opp-003",
    tittel: "Logistikkoordinator",
    kunde: "Bring",
    ansvarlig: "Anna Berg",
    status: "pauset",
    antallKandidater: 3,
    frist: "2026-10-01"
  },
  {
    id: "opp-004",
    tittel: "Regnskapsfører",
    kunde: "Sparebank 1",
    ansvarlig: "Mona Iversen",
    status: "avsluttet",
    antallKandidater: 8,
    frist: "2026-07-30"
  },
  {
    id: "opp-005",
    tittel: "Prosjektleder Bygg",
    kunde: "Veidekke",
    ansvarlig: "Erik Solheim",
    status: "aktiv",
    antallKandidater: 9,
    frist: "2026-09-20"
  },
  {
    id: "opp-006",
    tittel: "Kundeservicemedarbeider",
    kunde: "Telenor",
    ansvarlig: "Mona Iversen",
    status: "aktiv",
    antallKandidater: 20,
    frist: "2026-08-31"
  },
  {
    id: "opp-007",
    tittel: "Sykepleier, vikariat",
    kunde: "Oslo Kommune",
    ansvarlig: "Anna Berg",
    status: "pauset",
    antallKandidater: 2,
    frist: "2026-11-01"
  }
];
