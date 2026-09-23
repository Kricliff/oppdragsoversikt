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

    // Hent innlegget selv når vi ikke har sett det før. Det som står i skjemaet vinner
    // alltid over det vi henter - den som skriver noe har en grunn til det.
    // hentPaNytt lar admin be om en ny henting for et innlegg som allerede ligger der -
    // ellers ville de som ble lagt inn før dette fantes aldri fått tekst og bilde.
    const nytt = !tidFraFor.has(lenke) || i?.hentPaNytt === true;
    let fra = null;
    if (nytt) {
      try {
        fra = await hentForhandsvisning(lenke);
      } catch (err) {
        // Nettverksfeil, tidsavbrudd, endret markup: innlegget legges inn med det lille
        // vi vet, og resten kan skrives inn for hånd.
        console.warn("Fikk ikke hentet forhåndsvisning:", err);
      }
    }

    // Navnet står som regel i lenken selv, ellers i innlegget vi nettopp hentet.
    const navn =
      String(i?.navn ?? "").trim().slice(0, 60) || utledNavn(lenke) || (fra?.navn ?? "");
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
      // Ber noen uttrykkelig om en ny henting, skal bildet også friskes opp - innlegget
      // kan ha blitt redigert. Ellers hentes bildet bare når vi ikke har et fra før.
    } else if (fra?.bildeUrl && (!bilder.has(id) || i?.hentPaNytt === true)) {
      try {
        const hentet = await hentBilde(fra.bildeUrl);
        if (hentet) {
          await context.env.NOTAT_KV.put(BILDE_PREFIKS + id, hentet);
          bilder.add(id);
        }
      } catch (err) {
        console.warn("Fikk ikke hentet bildet fra innlegget:", err);
      }
    }
    renset.push({
      navn,
      tekst: (String(i?.tekst ?? "").trim() || (fra?.tekst ?? "")).slice(0, 280),
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

// ---------- forhåndsvisning hentet fra innlegget selv ----------
// LinkedIn legger ut Open Graph-merkelapper på hvert enkelt innlegg - det er slik Slack
// og WhatsApp lager forhåndsvisninger. Vi leser de samme merkelappene: teksten,
// forfatteren og bildet. Målt 2026-09-23: /feed/update/… og /posts/… svarer med dem,
// mens /company/…/posts/ sender deg til innloggingssiden.
//
// Dette er ikke skraping av profiler: ett kall per lenke noen limer inn for hånd, og bare
// de merkelappene LinkedIn selv publiserer for nettopp dette formålet.
//
// Alt her er beste forsøk. Svarer LinkedIn med noe annet enn ventet, står innlegget igjen
// med det som ble skrevet inn manuelt - det er bedre enn et halvt innlegg på veggen.
const NETTLESER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const BILDEVERTER = /(^|\.)licdn\.com$/;

async function hentForhandsvisning(lenke) {
  const res = await fetch(lenke, {
    headers: { "User-Agent": NETTLESER_UA, Accept: "text/html" },
    redirect: "follow"
  });
  if (!res.ok) return null;
  const html = await res.text();

  const merkelapp = (navn) => {
    const m = html.match(
      new RegExp('<meta[^>]+property="' + navn + '"[^>]*content="([^"]*)"', "i")
    );
    return m ? avkod(m[1]) : null;
  };

  // Havnet vi på innloggingssiden, er merkelappene LinkedIn sine egne - ikke innleggets.
  const url = merkelapp("og:url") ?? "";
  if (!url || /\/(login|uas\/login)/.test(url)) return null;

  const tittel = merkelapp("og:title") ?? "";
  // LinkedIn korter ned selve teksten i tittelen, men forfatteren står helt til slutt:
  // "… | Christina Waale Salomaa". Beskrivelsen har hele teksten.
  const skille = tittel.lastIndexOf(" | ");
  const navn = skille > 0 ? tittel.slice(skille + 3).trim() : "";

  return {
    navn: navn.slice(0, 60),
    tekst: (merkelapp("og:description") ?? "").replace(/\s+/g, " ").trim(),
    bildeUrl: merkelapp("og:image")
  };
}

// Bildet hentes fra LinkedIn sin egen mediavert og lagres hos oss. Å peke tavlen rett på
// media.licdn.com ville virket i dag og vært et hull i morgen: adressene der har en
// utløpsdel (?e=…&t=…), og en veggskjerm som står på i ukevis ville til slutt vist et
// tomt felt. Verten sjekkes, så vi aldri laster ned fra en adresse LinkedIn ikke eier.
async function hentBilde(bildeUrl) {
  let url;
  try {
    url = new URL(bildeUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !BILDEVERTER.test(url.hostname.toLowerCase())) return null;

  const res = await fetch(url.toString(), { headers: { "User-Agent": NETTLESER_UA } });
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) return null;

  const bytes = new Uint8Array(await res.arrayBuffer());
  // Base64 blir en tredjedel større enn kilden, og det er base64 som skal ligge i KV.
  if (bytes.length > (MAKS_BILDE_BYTES / 4) * 3) return null;

  let binaer = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binaer += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return "data:" + type + ";base64," + btoa(binaer);
}

// Merkelappene er HTML-rømt: bildeadressen har &amp; i seg, og teksten kan ha &#39;.
function avkod(raa) {
  return raa
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
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
