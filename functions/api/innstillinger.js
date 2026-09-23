// Enkle av/på-brytere for tavlens funksjoner, styrt fra admin - lar deg skru av en
// funksjon midlertidig (f.eks. under feilsøking eller en demo) uten en kodeutrulling.
// Skjermen sjekker denne med jevne mellomrom og laster seg selv på nytt ved endring
// (se sjekkInnstillinger i app.js), samme mønster som den selvfornyende deploy-sjekken.

import { harGyldigAdminNokkel, ikkeGodkjentSvar } from "../_lib/skrivevern.js";

const KV_KEY = "innstillinger";
// Alle felt er rene av/på-brytere (boolean), standard PÅ. Statlinje-feltene styrer
// hvilke av de fem tallene øverst på tavlen som vises - se STAT_FELT i app.js sin
// renderStats(), som må ha nøyaktig samme feltnavn.
const STANDARD = {
  kundenytt: true,
  linkedin: true,
  feiring: true,
  bursdager: true,
  teamskanal: true,
  statAktive: true,
  statUtfort: true,
  statSignerte: true,
  statAvsluttet: true,
  statSalgsmoter: true
};

export async function onRequestGet(context) {
  const lagret = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? {};
  return json({ ...STANDARD, ...lagret });
}

export async function onRequestPost(context) {
  if (!harGyldigAdminNokkel(context)) return ikkeGodkjentSvar(context, "innstillinger");

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const forrige = { ...STANDARD, ...((await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? {}) };
  const nye = { ...forrige };
  for (const felt of Object.keys(STANDARD)) {
    if (typeof body?.[felt] === "boolean") nye[felt] = body[felt];
  }

  try {
    await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(nye));
  } catch (err) {
    console.warn("Fikk ikke lagret innstillinger:", err);
  }

  return json(nye);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
