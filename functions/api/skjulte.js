// Manuelt skjulte oppdrag - styres fra /admin.
//
// Bakgrunn: RecMan har to statusdimensjoner. "Fasen" (Forespørsel/Aktiv/Løst/...) får vi
// via API-et og bruker på tavlen, men det ANDRE statusfeltet (Ikke satt/I rute/I fare/
// På vent/Av kurs/Fullført) er ikke eksponert i API-et i det hele tatt - 40 feltnavn og
// 6 scope-varianter er prøvd (2026-09-02), og det står heller ikke i RecMan sin egen
// feltliste for prosjekt, verken for lesing eller skriving.
//
// Løsningen er derfor denne lista: står et oppdrag som "På vent" i RecMan, kan det
// parkeres herfra, og hentes tilbake når det går til "I rute" igjen. Samme mønster som
// notat.js/bursdager.js - én delt liste alle med admin-tilgang kan redigere.

import { oppdragCacheKey } from "../_lib/oppdragCache.js";

const SKJULTE_KEY = "skjulte-oppdrag";
const MAKS_ANTALL = 200;

export async function onRequestGet(context) {
  return json({ skjulte: await lesListe(context.env.NOTAT_KV) });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const id = String(body?.id ?? "").trim().slice(0, 32);
  if (!/^\d+$/.test(id)) return json({ error: "Mangler gyldig prosjekt-id" }, 400);

  const liste = await lesListe(context.env.NOTAT_KV);
  const utenDenne = liste.filter((s) => s.id !== id);

  // vis === true betyr "hent tilbake på tavlen", ellers legges den til som skjult
  const oppdatert = body?.vis === true
    ? utenDenne
    : [
        ...utenDenne,
        {
          id,
          // Kun til visning i admin, slik at lista er lesbar uten å slå opp id-er
          tittel: String(body?.tittel ?? "").trim().slice(0, 120),
          kunde: String(body?.kunde ?? "").trim().slice(0, 120),
          ansvarlig: String(body?.ansvarlig ?? "").trim().slice(0, 80),
          skjultTidspunkt: Date.now()
        }
      ].slice(-MAKS_ANTALL);

  try {
    await context.env.NOTAT_KV.put(SKJULTE_KEY, JSON.stringify(oppdatert));
  } catch (err) {
    return json({ error: `Fikk ikke lagret: ${err}` }, 502);
  }

  // Uten dette ville tavlen fortsatt vist (eller fortsatt skjult) oppdraget i opptil
  // CACHE_SECONDS - 20 minutter - siden /api/oppdrag ligger i Cloudflares edge-cache.
  try {
    await caches.default.delete(oppdragCacheKey());
  } catch (err) {
    console.warn("Fikk ikke blanket oppdrag-cachen:", err);
  }

  return json({ success: true, skjulte: oppdatert });
}

async function lesListe(kv) {
  const liste = (await kv.get(SKJULTE_KEY, "json")) ?? [];
  return Array.isArray(liste) ? liste.filter((s) => s && /^\d+$/.test(String(s.id))) : [];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
