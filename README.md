# Oppdragsoversikt

Enkel webapp (vanilla JS, ingen build-steg) som viser aktive oppdrag og hvem som er
ansvarlig - laget for å stå på en skjerm på kontoret. Live på
[oppdragsoversikt.pages.dev](https://oppdragsoversikt.pages.dev) (bak Cloudflare Access).

## Kjøre lokalt

Åpne `index.html` direkte i en nettleser, eller kjør en enkel lokal server, f.eks.:

```bash
npx serve .
```

`/api/oppdrag` (se under) finnes ikke lokalt, så appen faller automatisk tilbake til
mock-data i `data/mock-oppdrag.js`.

## Recman-integrasjonen

Ekte data kommer fra [`functions/api/oppdrag.js`](functions/api/oppdrag.js), en
Cloudflare Pages Function som kjører server-side (kun på Cloudflare Pages, ikke på
GitHub Pages - Recman sitt API støtter ikke CORS, så nettleseren kan ikke kalle det
direkte uansett). `recman-adapter.js` kaller bare dette same-origin-endepunktet og
faller tilbake til mock-data hvis noe svikter.

API-nøkkelen ligger som et Cloudflare-secret (`RECMAN_API_KEY`), aldri i kode eller git.
Sett/oppdater med:

```bash
npx wrangler pages secret put RECMAN_API_KEY --project-name=oppdragsoversikt
```

Funksjonen henter fra Recman sitt v2-API (`project`, `user`, `company`,
`jobApplication`-scope) og svarer med `{ oppdrag: [...], kandidaterLandetIAr: N }`.
Hvert oppdrag normaliseres til feltene appen forstår: `id, tittel, kunde, ansvarlig,
status, fremdriftProsent, utfortDato`. `kandidaterLandetIAr` er et eget, ukoblet
totaltall (antall `jobApplication` med status "hired" i år) - ikke knyttet til
enkeltoppdrag, siden det krever "job post"-tilgang vi ikke har. Se kommentarene i
`oppdrag.js` for detaljer om statusmapping og filtrene som luker bort upålitelig data
(cancelled/lost, gamle "aktiv"-registreringer, ikke-kunder, oppdrag uten kjent
rådgiver).

Svaret cacher i `CACHE_SECONDS` på Cloudflares edge for å holde oss under Recman sitt
tak på 200 kall/dag. **Bump `CACHE_VERSION` i `oppdrag.js` når normaliseringslogikken
endres**, ellers kan en gammel cachet respons fortsette å bli servert i opptil
`CACHE_SECONDS` etter en deploy.

## Deploy

```bash
git push origin master                                            # GitHub (kildekode)
npx wrangler pages deploy . --project-name=oppdragsoversikt --branch=master   # Cloudflare (live)
```

## Filstruktur

| Fil | Beskrivelse |
|---|---|
| `index.html` / `style.css` | Layout og GreatPeople-tilpasset design |
| `app.js` | Rendering, tetthetsjustering, tavle-logikk |
| `functions/api/oppdrag.js` | Cloudflare Pages Function - henter og normaliserer ekte Recman-data |
| `recman-adapter.js` | Kaller `/api/oppdrag`, faller tilbake til mock-data hvis det feiler |
| `data/mock-oppdrag.js` | Eksempeldata brukt lokalt og som fallback |
