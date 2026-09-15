// Hvilken utrulling som kjører akkurat nå. Brukes av fabrikkvisningen (/fabrikk) til å
// merke at Claude har rullet ut ny kode.
//
// Cloudflare Pages gir hver utrulling sin egen URL, og injiserer den som CF_PAGES_URL.
// Den er derfor en pålitelig "hvilken versjon er dette"-nøkkel.
//
// Alternativet var å sammenligne ETag på de statiske filene, men det viste seg å ikke
// holde: Pages gir ETag på .js og .css, men IKKE på HTML-sider (de svarer uten både
// ETag, Last-Modified og Content-Length). En utrulling som kun rørte admin-siden,
// fabrikkvisningen eller en Function ville dermed passert helt ubemerket.
//
// Svaret er bevisst bittelite og ucachet - det skal kunne hentes ofte uten å koste noe.

export async function onRequestGet(context) {
  return new Response(
    JSON.stringify({
      utrulling: context.env.CF_PAGES_URL ?? null,
      commit: context.env.CF_PAGES_COMMIT_SHA ?? null,
      gren: context.env.CF_PAGES_BRANCH ?? null
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}
