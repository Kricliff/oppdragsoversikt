// Manuell telling av "Antall telefoner" og "Antall møter" - nullstilles automatisk ved
// ny måned. Lagres i samme KV som post-it-notatet (NOTAT_KV, se wrangler.toml), bare med
// en annen nøkkel. Ingen Recman-data involvert - dette er tall rådgiverne selv klikker inn.

const TELLING_KEY = "telling";
const FELTER = ["telefoner", "moter"];

export async function onRequestGet(context) {
  const telling = await hentGjeldendeTelling(context.env.NOTAT_KV);
  return json(telling);
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const felt = body?.felt;
  if (!FELTER.includes(felt)) {
    return json({ error: "Ukjent felt" }, 400);
  }

  const telling = await hentGjeldendeTelling(context.env.NOTAT_KV);

  if (typeof body.verdi === "number") {
    telling[felt] = Math.max(0, Math.round(body.verdi));
  } else if (typeof body.endring === "number") {
    telling[felt] = Math.max(0, telling[felt] + Math.round(body.endring));
  } else {
    return json({ error: "Mangler verdi eller endring" }, 400);
  }

  await context.env.NOTAT_KV.put(TELLING_KEY, JSON.stringify(telling));
  return json(telling);
}

// Sjekker om lagret telling er fra inneværende måned - hvis ikke, nullstilles den (og
// den nullstilte verdien lagres med det samme, slik at neste kall også ser 0, ikke bare
// dette ene svaret).
async function hentGjeldendeTelling(kv) {
  const gjeldendeMaaned = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const lagret = await kv.get(TELLING_KEY, "json");

  if (!lagret || lagret.maaned !== gjeldendeMaaned) {
    const nullstilt = { maaned: gjeldendeMaaned, telefoner: 0, moter: 0 };
    await kv.put(TELLING_KEY, JSON.stringify(nullstilt));
    return nullstilt;
  }
  return lagret;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
