// Cloudflare Pages Function - "Avsluttet denne måneden" til topplinjen.
//
// Tar utgangspunkt i prosjektets SISTE faktura til kunden i tredelingen
// oppstart/presentasjon/avslutning - se functions/_lib/tilbud.js for selve
// klassifiseringen (RecMan eksponerer ingen egen "oppdrag avsluttet"-status via API).

import { hentAvsluttedeOppdrag } from "../_lib/tilbud.js";

const CACHE_SECONDS = 20 * 60;
const CACHE_VERSION = 1;

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
  return { avsluttetDenneMnd };
}
