import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET"]
}));
app.use(express.json());

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
  return response.json();
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "WeatherNow API" }));

app.get("/api/weather", async (req, res) => {
  try {
    const city = String(req.query.city || "").trim();
    if (!city) return res.status(400).json({ error: "Please provide a city name." });
    if (city.length > 100) return res.status(400).json({ error: "City name is too long." });

    const key = city.toLowerCase();
    const cached = cache.get(key);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return res.json({ ...cached.data, cached: true });
    }

    const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geoUrl.search = new URLSearchParams({ name: city, count: "1", language: "en", format: "json" });
    const geo = await getJson(geoUrl);
    const place = geo.results?.[0];
    if (!place) return res.status(404).json({ error: `No location found for "${city}". Try another city.` });

    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.search = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "auto",
      forecast_days: "5"
    });
    const forecast = await getJson(forecastUrl);

    const data = {
      location: {
        name: place.name,
        country: place.country,
        admin1: place.admin1 || "",
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: forecast.timezone
      },
      current: forecast.current,
      currentUnits: forecast.current_units,
      daily: forecast.daily,
      dailyUnits: forecast.daily_units,
      fetchedAt: new Date().toISOString()
    };
    cache.set(key, { time: Date.now(), data });
    res.json(data);
  } catch (error) {
    console.error("Weather route error:", error);
    res.status(502).json({ error: "Unable to retrieve weather right now. Please try again." });
  }
});

app.listen(PORT, () => console.log(`WeatherNow API running at http://localhost:${PORT}`));
