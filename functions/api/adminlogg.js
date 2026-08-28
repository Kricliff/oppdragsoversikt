// Leser det lette aktivitetssporet skrevet av functions/_lib/adminlogg.js - vises i
// admin-siden sitt "Aktivitet"-kort.

const KV_KEY = "admin-aktivitetslogg";

export async function onRequestGet(context) {
  const tilstand = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? { hendelser: [] };
  return new Response(JSON.stringify({ hendelser: tilstand.hendelser }), {
    headers: { "Content-Type": "application/json" }
  });
}
