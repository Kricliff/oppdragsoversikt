// Bilde-oppslag - admin kan laste opp ett bilde som vises stort på selve tavlen (se
// .bilde-oppslag i style.css/app.js), f.eks. en plakat eller et resultat å feire.
// Lagres som data-URL i samme KV som resten av tavlen sine delte data. expirationTtl
// gjør at KV selv fjerner oppslaget etter 1 time hvis ingen fjerner det manuelt fra
// admin først - ingen egen opprydningsjobb nødvendig.

const KV_KEY = "tavle-bilde";
const VARIGHET_SEKUNDER = 60 * 60; // 1 time
const MAKS_BYTES = 6_000_000; // grovt vern - KV tåler mye mer, men en veggskjerm trenger aldri et større bilde enn dette

export async function onRequestGet(context) {
  const data = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? null;
  return json(data ?? { bilde: null, lagtUt: null });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  if (typeof body?.bilde !== "string" || !body.bilde.startsWith("data:image/")) {
    return json({ error: "Mangler eller ugyldig bilde" }, 400);
  }
  if (body.bilde.length > MAKS_BYTES) {
    return json({ error: "Bildet er for stort" }, 413);
  }

  const data = { bilde: body.bilde, lagtUt: Date.now() };
  await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(data), { expirationTtl: VARIGHET_SEKUNDER });
  return json(data);
}

export async function onRequestDelete(context) {
  await context.env.NOTAT_KV.delete(KV_KEY);
  return json({ bilde: null, lagtUt: null });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
