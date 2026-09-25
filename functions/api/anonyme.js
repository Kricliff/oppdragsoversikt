// Fortrolige kunder - styres fra /admin. Selve maskeringen skjer i de Functionene som
// publiserer kundenavn (oppdrag, feiring, kundenytt); her er bare lista.
//
// Samme mønster som skjulte.js: én delt liste alle med admin-tilgang kan redigere, og
// oppdragscachen tømmes ved endring så tavlen ikke står med det gamle navnet i 20
// minutter etter at noen ba om at det skulle bort.

import { oppdragCacheKey } from "../_lib/oppdragCache.js";
import { harGyldigAdminNokkel, ikkeGodkjentSvar } from "../_lib/skrivevern.js";
import { ANONYME_KV_KEY } from "../_lib/anonyme.js";

const MAKS_ANTALL = 200;

export async function onRequestGet(context) {
  return json({ anonyme: await lesListe(context.env.NOTAT_KV) });
}

export async function onRequestPost(context) {
  if (!harGyldigAdminNokkel(context)) return ikkeGodkjentSvar(context, "anonyme");

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const id = String(body?.id ?? "").replace(/^recman-/, "").trim().slice(0, 32);
  if (!/^\d+$/.test(id)) return json({ error: "Mangler gyldig prosjekt-id" }, 400);

  const liste = await lesListe(context.env.NOTAT_KV);
  const utenDenne = liste.filter((a) => a.id !== id);

  let oppdatert;
  if (body?.vis === true) {
    oppdatert = utenDenne;
  } else {
    // Selskaps-id-en er det maskeringen faktisk slår på. Uten den ville oppdraget stått
    // i lista uten å skjule noe som helst, og det er verre enn en tydelig feilmelding.
    const selskapId = String(body?.selskapId ?? "").trim().slice(0, 32);
    if (!/^\d+$/.test(selskapId)) return json({ error: "Mangler gyldig selskaps-id" }, 400);
    oppdatert = [
      ...utenDenne,
      { id, selskapId, tittel: String(body?.tittel ?? "").slice(0, 120), lagtTil: Date.now() }
    ].slice(-MAKS_ANTALL);
  }

  await context.env.NOTAT_KV.put(ANONYME_KV_KEY, JSON.stringify(oppdatert));

  // Uten dette ville tavlen vist det ekte navnet helt til cachen løp ut.
  try {
    await caches.default.delete(oppdragCacheKey());
  } catch (err) {
    console.warn("Fikk ikke tømt oppdragscachen:", err);
  }

  return json({ success: true, anonyme: oppdatert });
}

async function lesListe(kv) {
  const liste = (await kv.get(ANONYME_KV_KEY, "json")) ?? [];
  return Array.isArray(liste) ? liste : [];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
