// Statusmelding fra Claudes egne planlagte jobber (i dag: teamskanal-oppdatering, som
// kjører som en fristilt Claude-økt uten minne mellom kjøringene, se
// scheduled-tasks/teamskanal-oppdatering). Jobben melder fra her etter HVER kjøring,
// suksess som feil - det er den eneste delen av Claudes automatiserte arbeid som faktisk
// kan rapportere sin egen status utenfra, siden en levende Claude-økt ikke har noen
// løpende forbindelse til denne siden mens den jobber.
//
// Brukes av fabrikkvisningen (/fabrikk) til å tegne en rød ramme rundt CLAUDE-boksen når
// en jobb har feilet - se sjekkAgentStatus() der. Generisk på "oppgave", slik at flere
// planlagte jobber kan begynne å rapportere hit uten en endring i selve endepunktet.

import { harGyldigAdminNokkel, ikkeGodkjentSvar } from "../_lib/skrivevern.js";

const KV_KEY = "agent-status";
const MAKS_OPPGAVER = 20; // vern mot at en feilkonfigurert jobb vokser lagringen ubegrenset

export async function onRequestGet(context) {
  const data = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? { oppgaver: {} };
  return json(data);
}

export async function onRequestPost(context) {
  // Egen nøkkel (AGENT_STATUS_NOKKEL), ikke adminnøkkelen - denne kalles fra en
  // planlagt jobb sin egen økt, ikke fra /admin, og skal kunne roteres uavhengig.
  const nokkel = context.env.AGENT_STATUS_NOKKEL;
  if (!nokkel || context.request.headers.get("x-statusnokkel") !== nokkel) {
    return ikkeGodkjentSvar(context, "agentstatus");
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const oppgave = String(body?.oppgave ?? "").trim().slice(0, 60);
  if (!oppgave) return json({ error: "Mangler oppgave" }, 400);

  const data = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? { oppgaver: {} };
  data.oppgaver[oppgave] = {
    ok: body?.ok !== false,
    grunn: body?.ok === false ? String(body?.grunn ?? "ukjent feil").slice(0, 300) : null,
    sist: Date.now()
  };

  // Eldste oppgave fjernes først om lista skulle vokse forbi taket - i praksis skjer
  // ikke det med dagens én jobb, men koster ingenting å ha med.
  const navn = Object.keys(data.oppgaver);
  if (navn.length > MAKS_OPPGAVER) {
    navn.sort((a, b) => data.oppgaver[a].sist - data.oppgaver[b].sist);
    delete data.oppgaver[navn[0]];
  }

  await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(data));
  return json(data);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
