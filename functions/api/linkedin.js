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

// Bildene ligger for seg, én KV-nøkkel per innlegg. En veggskjerm henter listen hvert
// 5. minutt, og skal ikke dra med seg bildene den ikke viser.
const BILDE_PREFIKS = "linkedin-bilde:";
const MAKS_BILDE_BYTES = 900_000; // admin krymper bildet før opplasting - dette er taket

export async function onRequestGet(context) {
  // ?bilde=<id> henter ETT bilde. Bildene ligger under hver sin KV-nøkkel, ikke i listen,
  // nettopp fordi listen hentes hvert 5. minutt av en veggskjerm som ikke skal dra med
  // seg flere megabyte for å vise tre linjer tekst.
  const bildeId = new URL(context.request.url).searchParams.get("bilde");
  if (bildeId) {
    const bilde = await context.env.NOTAT_KV.get(BILDE_PREFIKS + reinId(bildeId));
    return json({ bilde: bilde ?? null });
  }
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

  // Hvilke innlegg som ALLEREDE har et bilde. Uten dette ville harBilde blitt false på
  // hver lagring der bildet ikke ble sendt med på nytt - altså hver gang noen retter en
  // tekst - og bildet blitt liggende igjen i KV uten at noe pekte på det.
  const bilder = new Set(forrige.filter((i) => i.harBilde).map((i) => i.bildeId ?? bildeId(i.lenke)));

  const raa = Array.isArray(body?.innlegg) ? body.innlegg : [];
  const renset = [];
  const avvist = [];
  const sett = new Set();
  for (const i of raa) {
    const lenke = normaliserLenke(i?.lenke);
    // En tavle på veggen skal ikke kunne vise en vilkårlig lenke noen limte inn i feil
    // felt. Er det ikke LinkedIn, er det enten en feil eller noe vi ikke vil ha der.
    if (!lenke) {
      avvist.push({ lenke: String(i?.lenke ?? ""), grunn: "Må være en https-lenke til linkedin.com." });
      continue;
    }
    if (sett.has(lenke)) continue;
    // Navnet står som regel i lenken selv. Å kreve at det skrives inn på nytt er unødig
    // arbeid for den som bare vil lime inn og gå videre - så vi utleder det, og lar
    // feltet være en overstyring for de tilfellene der lenken ikke røper noe navn.
    const navn = String(i?.navn ?? "").trim().slice(0, 60) || utledNavn(lenke);
    if (!navn) {
      avvist.push({ lenke: lenke, grunn: "Fant ikke navnet i lenken - skriv hvem som skrev det." });
      continue;
    }
    sett.add(lenke);
    // Bildet følger lenken, ikke raden: samme innlegg gir samme id, så en redigering av
    // teksten ikke mister bildet. harBilde er det eneste listen bærer - selve bildet
    // hentes for seg når det faktisk skal vises.
    const id = bildeId(lenke);
    if (typeof i?.bilde === "string" && i.bilde.startsWith("data:image/") && i.bilde.length <= MAKS_BILDE_BYTES) {
      await context.env.NOTAT_KV.put(BILDE_PREFIKS + id, i.bilde);
      bilder.add(id);
    } else if (i?.bilde === null) {
      await context.env.NOTAT_KV.delete(BILDE_PREFIKS + id);
      bilder.delete(id);
    }
    renset.push({
      navn,
      tekst: String(i?.tekst ?? "").trim().slice(0, 280),
      lenke,
      bildeId: id,
      harBilde: bilder.has(id),
      lagtInn: tidFraFor.get(lenke) ?? gyldigTid(i?.lagtInn) ?? new Date().toISOString(),
      kilde: i?.kilde === "firmaside" ? "firmaside" : "manuell"
    });
  }

  const liste = sortert(renset).slice(0, MAKS_ANTALL);
  await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(liste));

  // Et slettet innlegg skal ta bildet sitt med seg. Ellers ville bildene hopet seg opp i
  // KV uten at noe pekte på dem, og ingen ville noensinne oppdaget det.
  const beholdt = new Set(liste.map((i) => i.bildeId));
  for (const i of forrige) {
    const id = i.bildeId ?? bildeId(i.lenke);
    if (i.harBilde && !beholdt.has(id)) await context.env.NOTAT_KV.delete(BILDE_PREFIKS + id);
  }

  return json({ success: true, innlegg: liste, avvist });
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

// LinkedIn legger forfatteren inn i lenken: /posts/fornavn-etternavn_tema-activity-…,
// /in/fornavn-etternavn og /company/navn. Det som ikke røper noe navn er /feed/update/…
// - da må det skrives inn for hånd.
//
// Merk at LinkedIn translittererer norske tegn i slugen (Bjørn blir bjorn), så et utledet
// navn kan bli nesten riktig. Derfor overstyrer navnefeltet alltid det vi utleder.
function utledNavn(lenke) {
  const deler = new URL(lenke).pathname.split("/").filter(Boolean);
  let slug = null;
  if (deler[0] === "posts" && deler[1]) slug = deler[1].split("_")[0];
  else if ((deler[0] === "in" || deler[0] === "company" || deler[0] === "school") && deler[1]) slug = deler[1];
  if (!slug) return "";

  const ord = slug.split("-").filter(Boolean);
  // LinkedIn henger på en unik hale når flere har samme navn (…-1a2b3c4). Den er ikke
  // en del av navnet, og kjennes på at den blander bokstaver og tall.
  if (ord.length > 1) {
    const siste = ord[ord.length - 1];
    if (/\d/.test(siste) && /[a-z]/i.test(siste)) ord.pop();
  }
  return ord
    .map((o) => o.charAt(0).toUpperCase() + o.slice(1))
    .join(" ")
    .slice(0, 60);
}

// En kort, stabil id utledet av lenken (FNV-1a). Den skal bare være entydig nok til å
// skille innlegg fra hverandre som KV-nøkkel - den beskytter ingenting, så en enkel
// hash holder, og den må være den samme hver gang så et bilde ikke mister innlegget sitt.
function bildeId(lenke) {
  let h = 0x811c9dc5;
  for (let i = 0; i < lenke.length; i++) {
    h ^= lenke.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// Id-en kommer fra nettleseren og settes sammen til en KV-nøkkel. Alt annet enn tegnene
// en hash kan bestå av kastes, så ingen kan be om en helt annen nøkkel enn sin egen.
function reinId(raa) {
  return String(raa).replace(/[^a-z0-9]/gi, "").slice(0, 16);
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
