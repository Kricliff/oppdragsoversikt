// Siste LinkedIn-innlegg fra folk hos oss - vises i eget panel på tavlen.
//
// Hvorfor dette er en manuell liste og ikke en henting: LinkedIn har ingen åpen feed.
// RSS ble lagt ned i 2013, og det offisielle APIet gir kun en ORGANISASJONS egne
// sideinnlegg (Community Management API, krever godkjent app + sideadmin) - aldri
// personlige innlegg fra ansatte. Skraping er brudd på LinkedIn sine vilkår, og de
// blokkerer uansett utgående IP-er fra datasentre, som er nøyaktig det en Cloudflare
// Worker er. Det finnes altså ingen teknisk vei til "det Christina la ut i går".
//
// Derfor: den som ser innlegget limer inn lenken her, og tavlen viser det. Feltet kilde
// skiller manuelle innlegg fra dem en framtidig henting fra firmasiden legger inn, slik
// at en automatisk runde kan rydde i sine egne uten å røre de manuelle.

import { harGyldigAdminNokkel, ikkeGodkjentSvar } from "../_lib/skrivevern.js";

const KV_KEY = "linkedin-innlegg";
const MAKS_ANTALL = 40;
// Tavlen skal vise det som er ferskt. Eldre innlegg slettes ikke - de filtreres bort ved
// visning - slik at en feilaktig dato kan rettes i admin uten at innlegget er tapt.
const FERSKHET_DAGER = 30;

export async function onRequestGet(context) {
  const innlegg = sortert(await les(context)).filter(erFerskt).slice(0, 12);
  return json({ innlegg });
}

export async function onRequestPost(context) {
  if (!harGyldigAdminNokkel(context)) return ikkeGodkjentSvar(context, "linkedin");

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const forrige = await les(context);
  // Et innlegg beholder tidspunktet sitt gjennom en redigering. Uten dette ville hver
  // lagring i admin flyttet alt til toppen og gjort "nyeste" meningsløst.
  const tidFraFor = new Map(forrige.map((i) => [i.lenke, i.lagtInn]));

  const raa = Array.isArray(body?.innlegg) ? body.innlegg : [];
  const renset = [];
  const sett = new Set();
  for (const i of raa) {
    const lenke = normaliserLenke(i?.lenke);
    // En tavle på veggen skal ikke kunne vise en vilkårlig lenke noen limte inn i feil
    // felt. Er det ikke LinkedIn, er det enten en feil eller noe vi ikke vil ha der.
    if (!lenke || sett.has(lenke)) continue;
    const navn = String(i?.navn ?? "").trim().slice(0, 60);
    if (!navn) continue;
    sett.add(lenke);
    renset.push({
      navn,
      tekst: String(i?.tekst ?? "").trim().slice(0, 280),
      lenke,
      lagtInn: tidFraFor.get(lenke) ?? gyldigTid(i?.lagtInn) ?? new Date().toISOString(),
      kilde: i?.kilde === "firmaside" ? "firmaside" : "manuell"
    });
  }

  const liste = sortert(renset).slice(0, MAKS_ANTALL);
  await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(liste));
  return json({ success: true, innlegg: liste });
}

async function les(context) {
  const liste = await context.env.NOTAT_KV.get(KV_KEY, "json");
  return Array.isArray(liste) ? liste : [];
}

function sortert(liste) {
  return [...liste].sort((a, b) => String(b.lagtInn).localeCompare(String(a.lagtInn)));
}

function erFerskt(i) {
  const t = Date.parse(i.lagtInn);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= FERSKHET_DAGER * 86400000;
}

// Beholder bare det lenken trenger for å virke. Sporingsparametre (?utm_source=...,
// ?trackingId=...) henger med når man kopierer fra LinkedIn-appen, og to kopier av samme
// innlegg ville ellers sett ut som to forskjellige innlegg.
function normaliserLenke(raa) {
  let url;
  try {
    url = new URL(String(raa ?? "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const vert = url.hostname.toLowerCase();
  if (vert !== "linkedin.com" && !vert.endsWith(".linkedin.com")) return null;
  return "https://" + vert + url.pathname.replace(/\/+$/, "");
}

function gyldigTid(raa) {
  const t = Date.parse(String(raa ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
