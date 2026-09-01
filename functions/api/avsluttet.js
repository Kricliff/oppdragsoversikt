// Cloudflare Pages Function - "Avsluttet denne måneden" til topplinjen, og en liste over
// nylig avsluttede oppdrag (til admin sin "Siste endringer på tavlen").
//
// Tar utgangspunkt i prosjektets SISTE faktura til kunden i tredelingen
// oppstart/presentasjon/avslutning - se functions/_lib/tilbud.js for selve
// klassifiseringen (RecMan eksponerer ingen egen "oppdrag avsluttet"-status via API).

import { hentAvsluttedeOppdrag } from "../_lib/tilbud.js";

const CACHE_SECONDS = 20 * 60;
const CACHE_VERSION = 2;
const NYLIGE_DAGER = 30; // hvor langt tilbake admin-listen viser

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://oppdragsoversikt-cache.internal/avsluttet?v=${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const payload = await hentPayload(context.env.RECMAN_API_KEY);
    const response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), avsluttetDenneMnd: null }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function hentPayload(apiKey) {
  const avsluttedeOppdrag = await hentAvsluttedeOppdrag(apiKey);

  const gjeldendeMaaned = new Date().toISOString().slice(0, 7);
  const avsluttetDenneMnd = avsluttedeOppdrag.filter((o) => o.dato.slice(0, 7) === gjeldendeMaaned).length;

  const grenseDato = new Date(Date.now() - NYLIGE_DAGER * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const nylige = avsluttedeOppdrag
    .filter((o) => o.dato.slice(0, 10) >= grenseDato)
    .sort((a, b) => (a.dato < b.dato ? 1 : -1));

  return { avsluttetDenneMnd, nylige };
}
