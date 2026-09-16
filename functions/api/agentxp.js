// Varig XP for agentene i /fabrikk sitt kommandosenter. Tidligere ble XP regnet helt
// klient-side fra dagens logg og nullstilt hver dag/enhet - denne lagrer i stedet en
// KUMULATIV sum per agent i KV, slik at nivået består på tvers av dager og skjermer.
//
// Skrives UBESKYTTET av adminnøkkel, med vilje - samme mønster som skjermer.js sin
// heartbeat: dette er et synlig, ufarlig tellerverk uten sikkerhetsverdi å beskytte
// (verste utfall er et falskt høyt XP-tall), og kalles automatisk av selve
// /fabrikk-siden - ikke av en innlogget admin-bruker som kan bære en nøkkel.
// _middleware.js sin grense-sperre på ikke-produksjon beskytter den likevel, som alt
// annet uten egen nøkkel.
//
// Skrives BEVISST sjelden fra klienten (se sendXpTillegg() i fabrikk/index.html - kun
// fra det 5-minutters-tunge sjekkintervallet, og kun differansen siden forrige gang) -
// KV-skrivekvoten er 1000/døgn for HELE siden, og XP er ikke viktig nok til å
// rettferdiggjøre en skriving per hendelse.

const KV_KEY = "agent-xp-total";
const MAKS_AGENTER = 30; // vern mot en uventet stor payload
const MAKS_TILLEGG_PER_KALL = 20; // ingen enkelt innsending skal kunne hoppe flere nivåer i ett sprang

export async function onRequestGet(context) {
  const data = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? { xp: {} };
  return json(data);
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const tillegg = body?.tillegg;
  if (!tillegg || typeof tillegg !== "object" || Array.isArray(tillegg)) {
    return json({ error: "Mangler tillegg" }, 400);
  }

  const data = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? { xp: {} };
  const nokler = Object.keys(tillegg).slice(0, MAKS_AGENTER);
  for (const id of nokler) {
    const n = Math.max(0, Math.min(MAKS_TILLEGG_PER_KALL, Math.floor(Number(tillegg[id]) || 0)));
    if (n > 0) data.xp[id] = (data.xp[id] ?? 0) + n;
  }
  data.oppdatert = Date.now();

  try {
    await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(data));
  } catch (err) {
    return json({ error: "Fikk ikke lagret: " + err }, 502);
  }
  return json(data);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
