// Bursdagsliste - lagres manuelt i Cloudflare KV siden Recman ikke har fødselsdato på
// ansatte (bekreftet ved testing mot både v1- og v2-APIet). Samme mønster som notat.js:
// én delt liste alle med admin-tilgang kan redigere.

import { loggAdminHandling } from "../_lib/adminlogg.js";

const BURSDAGER_KEY = "bursdager";
const MAKS_ANTALL = 100;

export async function onRequestGet(context) {
  const liste = (await context.env.NOTAT_KV.get(BURSDAGER_KEY, "json")) ?? [];
  return json({ bursdager: liste });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const raa = Array.isArray(body?.bursdager) ? body.bursdager : [];
  const renset = raa
    .map((b) => ({
      navn: String(b?.navn ?? "").trim().slice(0, 60),
      dato: String(b?.dato ?? "").trim()
    }))
    .filter((b) => b.navn && /^\d{4}-\d{2}-\d{2}$/.test(b.dato))
    .slice(0, MAKS_ANTALL);

  const forrige = (await context.env.NOTAT_KV.get(BURSDAGER_KEY, "json")) ?? [];
  await context.env.NOTAT_KV.put(BURSDAGER_KEY, JSON.stringify(renset));

  // Klienten sender alltid HELE listen (ikke en diff) - finn selv hva som faktisk
  // endret seg, til bruk i aktivitetsloggen på admin.
  const nokkel = (b) => `${b.navn}|${b.dato}`;
  const forrigeSet = new Set(forrige.map(nokkel));
  const nySet = new Set(renset.map(nokkel));
  const lagtTil = renset.filter((b) => !forrigeSet.has(nokkel(b)));
  const fjernet = forrige.filter((b) => !nySet.has(nokkel(b)));

  for (const b of lagtTil) {
    context.waitUntil(loggAdminHandling(context.env.NOTAT_KV, context.request, `La til bursdag: ${b.navn}`));
  }
  for (const b of fjernet) {
    context.waitUntil(loggAdminHandling(context.env.NOTAT_KV, context.request, `Fjernet bursdag: ${b.navn}`));
  }

  return json({ success: true, bursdager: renset });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
