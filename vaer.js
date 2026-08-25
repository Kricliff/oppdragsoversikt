// Henter værmelding for Oslo fra functions/api/vaer.js (ekte MET/Yr-data).

const VAER_SYMBOL_IKON = {
  clearsky_day: "☀️",
  clearsky_night: "🌙",
  clearsky_polartwilight: "☀️",
  fair_day: "🌤️",
  fair_night: "🌙",
  fair_polartwilight: "🌤️",
  partlycloudy_day: "⛅",
  partlycloudy_night: "☁️",
  partlycloudy_polartwilight: "⛅",
  cloudy: "☁️",
  fog: "🌫️",
  rainshowers_day: "🌦️",
  rainshowers_night: "🌦️",
  rainshowersandthunder_day: "⛈️",
  rainshowersandthunder_night: "⛈️",
  lightrainshowers_day: "🌦️",
  lightrainshowers_night: "🌦️",
  heavyrainshowers_day: "🌧️",
  heavyrainshowers_night: "🌧️",
  rain: "🌧️",
  lightrain: "🌦️",
  heavyrain: "🌧️",
  rainandthunder: "⛈️",
  thunder: "⛈️",
  sleet: "🌨️",
  sleetshowers_day: "🌨️",
  sleetshowers_night: "🌨️",
  lightsleet: "🌨️",
  heavysleet: "🌨️",
  snow: "❄️",
  snowshowers_day: "❄️",
  snowshowers_night: "❄️",
  lightsnow: "🌨️",
  heavysnow: "❄️"
};

function vaerIkonForSymbol(symbolKode) {
  return VAER_SYMBOL_IKON[symbolKode] ?? "⛅";
}

async function hentVaer() {
  try {
    const res = await fetch("/api/vaer");
    if (!res.ok) throw new Error(`Uventet status ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("Fikk ikke hentet vær:", err);
    return null;
  }
}
