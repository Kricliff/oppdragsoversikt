// Kunder som ikke skal kunne leses av tavlen.
//
// Noen oppdrag er fortrolige - kunden har bedt om at det ikke er kjent at de søker, eller
// stillingen er ikke kunngjort hos dem ennå. Oppdraget skal fortsatt telle med og stå hos
// rådgiveren, men kundenavnet skal ikke stå på en skjerm i resepsjonen.
//
// Tre valg er verdt å vite om:
//
// 1. Maskeringen skjer på SERVEREN. Gjorde vi det i app.js, ville det ekte navnet ligget i
//    svaret fra /api/oppdrag, og hvem som helst som åpner utviklerverktøyet på tavlen
//    kunne lest det. Da hadde vi skjult det for øyet, ikke for den som leter.
//
// 2. Du peker ut et OPPDRAG, men det er KUNDEN som blir hemmelig. Et hemmelig
//    kundeforhold lekker like fullt gjennom et annet oppdrag for samme kunde, gjennom
//    «X er ny kunde»-feiringen, eller gjennom kundenytt-panelet. Derfor lagres selskaps-
//    id-en sammen med oppdraget, og alle tre stedene slår opp i den.
//
// 3. Selskaps-id-en lagres i stedet for å slås opp ved hver henting. kundenytt.js henter
//    bare selskaper fra Recman, aldri prosjekter, og skulle den regne seg fram fra
//    oppdraget måtte den hentet hele prosjektlista hvert tiende minutt for å skjule ett
//    navn.

export const ANONYME_KV_KEY = "anonyme-oppdrag";

// Bevisst nøytralt: det skal se ut som en villet anonymisering, ikke som manglende data.
export const ANONYM_MERKE = "Konfidensiell kunde";

// Merk at denne kaster hvis KV ikke svarer, i motsetning til søsteren hentSkjulteIder,
// som heller viser for mye. Her er det motsatt vei som er forsiktig: kan vi ikke lese
// lista, vet vi ikke hva som er hemmelig. Da er det riktigere at kallet feiler - tavlen
// står da med forrige svar og melder fra i bunnteksten - enn at det svarer pent med et
// kundenavn som ikke skulle ut.
export async function hentAnonyme(kv) {
  if (!kv) return [];
  const liste = (await kv.get(ANONYME_KV_KEY, "json")) ?? [];
  if (!Array.isArray(liste)) return [];
  return liste
    .map((a) => ({ id: String(a?.id ?? ""), selskapId: String(a?.selskapId ?? "") }))
    .filter((a) => a.id);
}

export function anonymeSelskapIder(liste) {
  return new Set(liste.map((a) => a.selskapId).filter(Boolean));
}

export function anonymeProsjektIder(liste) {
  return new Set(liste.map((a) => a.id));
}
