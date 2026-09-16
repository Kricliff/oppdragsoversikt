// Forslagskøen til agentmøtet (Arkitekt, Cybersec, Coder, Tester, Administrator - se
// scheduled-tasks/agentmote). Dette er den delte tilstanden som binder møtene sammen:
// planlagte Claude-økter har verken minne mellom kjøringer eller noen kanal til
// hverandre, så alt som skal overleve et møte må ligge her.
//
// GODKJENNINGSPORTEN ER SELVE POENGET MED DENNE FILA.
//
// Kristian har ett absolutt krav: ingen endring i Oppdragsoversikt skal gjennomføres
// uten hans godkjenning. Det kravet er derfor IKKE lagt i en instruks til agentene - en
// instruks kan en agent overse eller bli lurt til å overse. Det ligger som en nøkkelsjekk
// og en overgangstabell her i serveren:
//
//   - AGENT_STATUS_NOKKEL (x-statusnokkel) har agentene. Den kan legge inn forslag,
//     føre et GODKJENT forslag videre gjennom bygging og testing, og blokkere noe som
//     ser farlig ut. Den kan IKKE sette "godkjent" eller "avvist" - forsøk gir 403.
//   - ADMIN_SKRIVENOKKEL (x-adminnokkel) har kun /admin, altså Kristian selv. Den er
//     eneste vei til "godkjent" og "avvist", og eneste vei ut av "blokkert".
//
// Konsekvensen: en agent som går av skaftet - eller som blir instruert av en nettside
// Arkitekten leste - kan ikke godkjenne sitt eget arbeid. Den kommer ikke forbi "ny".

import { harGyldigAdminNokkel, ikkeGodkjentSvar } from "../_lib/skrivevern.js";

const KV_KEY = "agent-forslag";
const MAKS_FORSLAG = 40;
const MAKS_REFERAT = 20;
const MAKS_APNE = 12; // vern mot forslagsspam - et kort med 30 forslag blir aldri lest

// Hvem som får flytte et forslag hvorhen. Tomt sett = ingen kan.
// "agent" = AGENT_STATUS_NOKKEL, "admin" = ADMIN_SKRIVENOKKEL.
const OVERGANGER = {
  ny:        { agent: ["blokkert"],          admin: ["godkjent", "avvist"] },
  godkjent:  { agent: ["bygges", "blokkert"], admin: ["avvist"] },
  bygges:    { agent: ["testes", "blokkert"], admin: ["avvist"] },
  testes:    { agent: ["ferdig", "bygges", "blokkert"], admin: ["avvist"] },
  ferdig:    { agent: [],                    admin: [] },
  avvist:    { agent: [],                    admin: [] },
  // Blokkert er Cybersec sin nødbrems. Bare Kristian kommer ut av den igjen.
  blokkert:  { agent: [],                    admin: ["avvist", "ny"] }
};

export async function onRequestGet(context) {
  const data = await les(context);
  return json(data);
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const handling = String(body?.handling ?? "").trim();
  const erAdmin = harGyldigAdminNokkel(context);
  const agentNokkel = context.env.AGENT_STATUS_NOKKEL;
  const erAgent = !!agentNokkel && context.request.headers.get("x-statusnokkel") === agentNokkel;

  if (!erAdmin && !erAgent) return ikkeGodkjentSvar(context, "forslag");

  const data = await les(context);

  if (handling === "nytt") {
    if (!erAgent) return json({ error: "Kun agenter legger inn forslag" }, 403);
    const apne = data.forslag.filter((f) => ["ny", "godkjent", "bygges", "testes"].includes(f.status)).length;
    if (apne >= MAKS_APNE) return json({ error: "Køen er full (" + MAKS_APNE + " åpne) - rydd før du legger inn mer" }, 409);

    const tittel = tekst(body?.tittel, 120);
    if (!tittel) return json({ error: "Mangler tittel" }, 400);
    // Samme tittel to ganger er nesten alltid Arkitekten som fant det samme igjen.
    if (data.forslag.some((f) => f.tittel.toLowerCase() === tittel.toLowerCase() && f.status !== "avvist")) {
      return json({ error: "Finnes allerede", duplikat: true }, 409);
    }

    data.forslag.unshift({
      id: "f-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      tittel,
      begrunnelse: tekst(body?.begrunnelse, 900),
      krever: tekst(body?.krever, 500),
      risiko: tekst(body?.risiko, 500),
      anslag: tekst(body?.anslag, 120),
      kilder: Array.isArray(body?.kilder) ? body.kilder.slice(0, 6).map((k) => tekst(k, 300)) : [],
      kilde: tekst(body?.kilde, 40) || "arkitekt",
      status: "ny",
      sikkerhet: null,
      gren: null,
      forhandsvisning: null,
      testresultat: null,
      opprettet: Date.now(),
      endret: Date.now(),
      avgjort: null
    });
  } else if (handling === "status" || handling === "avgjor") {
    const f = data.forslag.find((x) => x.id === body?.id);
    if (!f) return json({ error: "Ukjent forslag" }, 404);

    const ny = String(body?.status ?? "").trim();
    const rolle = handling === "avgjor" ? "admin" : "agent";

    // Rollen må stemme med nøkkelen. En agent kan ikke kalle seg admin.
    if (rolle === "admin" && !erAdmin) return ikkeGodkjentSvar(context, "forslag-avgjor");
    if (rolle === "agent" && !erAgent) return json({ error: "Feil nøkkel for denne handlingen" }, 403);

    const lov = (OVERGANGER[f.status] ?? {})[rolle] ?? [];
    if (!lov.includes(ny)) {
      return json({
        error: "Ikke tillatt overgang",
        fra: f.status,
        til: ny,
        rolle,
        tillatt: lov,
        // Den vanligste grunnen til at en agent lander her, og derfor verdt å si rett ut.
        hint: rolle === "agent" && (ny === "godkjent" || ny === "avvist")
          ? "Kun Kristian godkjenner eller avviser. Legg forslaget fram for ham i stedet."
          : undefined
      }, 403);
    }

    f.status = ny;
    f.endret = Date.now();
    if (rolle === "admin") f.avgjort = Date.now();
    if (body?.gren !== undefined) f.gren = tekst(body.gren, 200);
    if (body?.forhandsvisning !== undefined) f.forhandsvisning = tekst(body.forhandsvisning, 300);
    if (body?.testresultat !== undefined) f.testresultat = tekst(body.testresultat, 900);
    if (body?.sikkerhet !== undefined) {
      f.sikkerhet = { merknad: tekst(body.sikkerhet, 900), tid: Date.now() };
    }
    if (body?.merknad !== undefined) f.merknad = tekst(body.merknad, 500);
  } else if (handling === "referat") {
    if (!erAgent) return json({ error: "Kun agenter skriver referat" }, 403);
    data.referat.unshift({
      tid: Date.now(),
      mote: tekst(body?.mote, 40),
      deltakere: Array.isArray(body?.deltakere) ? body.deltakere.slice(0, 8).map((d) => tekst(d, 40)) : [],
      tekst: tekst(body?.tekst, 2000)
    });
    data.referat = data.referat.slice(0, MAKS_REFERAT);
  } else {
    return json({ error: "Ukjent handling" }, 400);
  }

  // Ferdige og avviste ryddes bort først når lista er full - de er historikk, ikke kø.
  if (data.forslag.length > MAKS_FORSLAG) {
    const aktive = data.forslag.filter((f) => !["ferdig", "avvist"].includes(f.status));
    const gamle = data.forslag.filter((f) => ["ferdig", "avvist"].includes(f.status));
    data.forslag = aktive.concat(gamle).slice(0, MAKS_FORSLAG);
  }

  data.oppdatert = Date.now();
  try {
    await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(data));
  } catch (err) {
    return json({ error: "Fikk ikke lagret: " + err }, 502);
  }
  return json(data);
}

async function les(context) {
  const data = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? {};
  return { forslag: data.forslag ?? [], referat: data.referat ?? [], oppdatert: data.oppdatert ?? null };
}

function tekst(v, maks) {
  return String(v ?? "").trim().slice(0, maks);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
