// Cloudflare Pages Function - leser endringsloggen som functions/api/oppdrag.js
// bygger opp (nye/borte/status-endrede oppdrag), til bruk på /admin. Ingen egen
// cache her - dette er et rent KV-oppslag, ikke et eksternt API-kall, og admin skal
// se ferskest mulig data når de faktisk sjekker.

const KV_KEY = "oppdrag-endringslogg";

export async function onRequestGet(context) {
  try {
    const tilstand = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? { hendelser: [] };
    const hendelser = [...(tilstand.hendelser ?? [])].sort((a, b) => b.tidspunkt - a.tidspunkt);
    return new Response(JSON.stringify({ hendelser }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), hendelser: [] }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}
