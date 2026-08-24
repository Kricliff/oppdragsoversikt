# Oppdragsoversikt

Enkel webapp (vanilla JS, ingen build-steg) som viser aktive oppdrag og hvem som er ansvarlig.
Kjører i dag på mock-data, klar for å kobles mot Recman.

## Kjøre lokalt

Åpne `index.html` direkte i en nettleser, eller kjør en enkel lokal server, f.eks.:

```bash
npx serve .
```

## Koble til Recman

Alt API-oppsett ligger i [`recman-adapter.js`](recman-adapter.js):

1. Fyll inn `RECMAN_CONFIG.baseUrl` og sett `enabled: true`.
2. **Ikke** legg API-nøkkelen rett i klientkoden i produksjon - rut kallet via en liten backend/proxy som holder på nøkkelen, og la `fetchFromRecman()` kalle den proxyen i stedet for Recman direkte.
3. Juster `mapRecmanRespons()` til det faktiske feltnavnene Recman returnerer (title/client/owner/status/osv.), slik at resten av appen (`app.js`) fortsetter å fungere uendret - den kjenner bare til feltene `id, tittel, kunde, ansvarlig, status, antallKandidater, utfortDato, fremdriftProsent`. `fremdriftProsent` er et tall 0-100 (samme fremdriftsprosent som settes på oppdraget i Recman) og vises kun på aktive oppdrag, som tekst og som en tynn fremdriftslinje.

## Filstruktur

| Fil | Beskrivelse |
|---|---|
| `index.html` | Layout: søk, filtre, tabell |
| `style.css` | Styling |
| `app.js` | Rendering, filtrering, sortering |
| `data/mock-oppdrag.js` | Eksempeldata |
| `recman-adapter.js` | Datakilde-abstraksjon (mock i dag, Recman senere) |
