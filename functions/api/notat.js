// Delt post-it-lapp - lagres i Cloudflare KV (binding NOTAT_KV, se wrangler.toml) slik
// at alle som ser på/redigerer skjermen ser samme melding, uansett enhet.
// Ingen historikk, ingen forfatter - bare én tekst alle kan overskrive.

const NOTAT_KEY = "notat";
const MAKS_LENGDE = 500;

export async function onRequestGet(context) {
  const tekst = (await context.env.NOTAT_KV.get(NOTAT_KEY)) ?? "";
  return json({ tekst });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const tekst = String(body?.tekst ?? "").slice(0, MAKS_LENGDE);
  await context.env.NOTAT_KV.put(NOTAT_KEY, tekst);
  return json({ success: true, tekst });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
