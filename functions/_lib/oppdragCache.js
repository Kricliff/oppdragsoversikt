// Cache-nøkkelen for /api/oppdrag, delt mellom functions/api/oppdrag.js (som skriver
// den) og functions/api/skjulte.js (som blanker den når skjuleliste endres, slik at
// tavlen ikke fortsetter å vise et parkert oppdrag i opptil CACHE_SECONDS etterpå).
//
// Versjonen bumpes når normaliseringslogikken i oppdrag.js endres, slik at gamle
// cachede svar ikke fortsetter å bli servert etter en deploy.
export const OPPDRAG_CACHE_VERSION = 27;

export function oppdragCacheKey() {
  return new Request(`https://oppdragsoversikt-cache.internal/oppdrag?v=${OPPDRAG_CACHE_VERSION}`);
}
