// Bursdagsliste - lagres manuelt i Cloudflare KV siden Recman ikke har fødselsdato på
// ansatte (bekreftet ved testing mot både v1- og v2-APIet). Samme mønster som notat.js:
// én delt liste alle med admin-tilgang kan redigere.

const BURSDAGER_KEY = "bursdager";
const MAKS_ANTALL = 100;

export async function onRequestGet(context) {
  const liste = (await context.env.NOTAT_KV.get(BURSDAGER_KEY, "json")) ?? [];
  return json({ bursdager: liste });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const raa = Array.isArray(body?.bursdager) ? body.bursdager : [];
  const renset = raa
    .map((b) => ({
      navn: String(b?.navn ?? "").trim().slice(0, 60),
      dato: String(b?.dato ?? "").trim()
    }))
    .filter((b) => b.navn && /^\d{4}-\d{2}-\d{2}$/.test(b.dato))
    .slice(0, MAKS_ANTALL);

  await context.env.NOTAT_KV.put(BURSDAGER_KEY, JSON.stringify(renset));
  return json({ success: true, bursdager: renset });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
