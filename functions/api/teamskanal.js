// Cloudflare Pages Function - viser siste meldinger fra Teams-gruppechatten
// "GreatPeople på kontoret" i et eget panel på tavlen.
//
// Cloudflare Workers kan ikke selv logge inn mot Microsoft Graph uten en egen
// Azure-appregistrering (OAuth) - dette er bevisst IKKE bygget ennå, se samtalen
// med Kristian. I stedet skriver en ekstern kilde (i dag: en Claude-økt som
// allerede har tilgang til Teams-kontoen via Microsoft 365-tilkoblingen) de
// siste meldingene hit via POST, og denne Function-en cacher/serverer dem
// videre til tavlen - samme mønster som post-it (notat.js) sitt lagringslager,
// bare med flere rader.
const KV_KEY = "teamskanal-meldinger";
const MAKS_MELDINGER = 10;

export async function onRequestGet(context) {
  const data = (await context.env.NOTAT_KV.get(KV_KEY, "json")) ?? { meldinger: [], sistOppdatert: null };
  return json(data);
}

export async function onRequestPost(context) {
  const nokkel = context.env.TEAMSKANAL_SKRIVENOKKEL;
  if (nokkel && context.request.headers.get("x-skrivenokkel") !== nokkel) {
    return json({ error: "Mangler eller feil nøkkel" }, 401);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }
  if (!Array.isArray(body?.meldinger)) return json({ error: "Mangler meldinger[]" }, 400);

  const meldinger = body.meldinger
    .filter((m) => m && typeof m.fra === "string" && typeof m.tekst === "string" && typeof m.tidspunkt === "string")
    .slice(0, MAKS_MELDINGER)
    // 1000 er ikke en tilsiktet avkorting av selve meldingen (den skal vises i sin
    // helhet), bare et vern mot at noen (ved en feil) poster noe absurd langt hit.
    .map((m) => ({ fra: m.fra.slice(0, 60), tekst: m.tekst.slice(0, 1000), tidspunkt: m.tidspunkt }));

  const data = { meldinger, sistOppdatert: Date.now() };

  try {
    await context.env.NOTAT_KV.put(KV_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("Fikk ikke skrevet teamskanal-meldinger til KV:", err);
    return json({ error: "Fikk ikke lagret" }, 502);
  }

  return json(data);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
