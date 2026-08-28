// Enkle av/på-brytere for tavlens funksjoner, styrt fra admin - lar deg skru av en
// funksjon midlertidig (f.eks. under feilsøking eller en demo) uten en kodeutrulling.
// Skjermen sjekker denne med jevne mellomrom og laster seg selv på nytt ved endring
// (se sjekkInnstillinger i app.js), samme mønster som den selvfornyende deploy-sjekken.

import { loggAdminHandling } from "../_lib/adminlogg.js";

const KV_KEY = "innstillinger";
const STANDARD = { kundenytt: true, feiring: true, bursdager: true };
const NAVN_FOR_VISNING = { kundenytt: "Kundenytt", feiring: "Feiring", bursdager: "Bursdager" };

export async function onRequestGet(context) {
  const lagret = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? {};
  return json({ ...STANDARD, ...lagret });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const forrige = { ...STANDARD, ...((await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? {}) };
  const nye = {
    kundenytt: typeof body?.kundenytt === "boolean" ? body.kundenytt : forrige.kundenytt,
    feiring: typeof body?.feiring === "boolean" ? body.feiring : forrige.feiring,
    bursdager: typeof body?.bursdager === "boolean" ? body.bursdager : forrige.bursdager
  };

  try {
    await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(nye));
  } catch (err) {
    console.warn("Fikk ikke lagret innstillinger:", err);
  }

  for (const felt of Object.keys(NAVN_FOR_VISNING)) {
    if (nye[felt] !== forrige[felt]) {
      context.waitUntil(
        loggAdminHandling(context.env.NOTAT_KV, context.request, `Skrudde ${nye[felt] ? "på" : "av"} ${NAVN_FOR_VISNING[felt]}`)
      );
    }
  }

  return json(nye);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
