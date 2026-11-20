import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET"]
}));

app.use(express.json());

// Cache configuration
const cache = new Map();
const inFlight = new Map();

const CACHE_TTL = 15 * 60 * 1000;
const STALE_CACHE_TTL = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 12000;

// Provider cooldown
let providerCooldownUntil = 0;

// Concurrent request limit
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 2;

// Utility functions
const delay = (ms) =>
  new Promise(resolve => setTimeout(resolve, ms));

async function acquireSlot() {
  while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await delay(300);
  }

  activeRequests++;
}

function releaseSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
}

// WeatherAPI request
async function getJson(url) {
  if (!WEATHER_API_KEY) {
    throw new Error("WEATHER_API_KEY is missing.");
  }

  if (Date.now() < providerCooldownUntil) {
    const error = new Error(
      "Weather provider is temporarily unavailable."
    );

    error.status = 503;
    throw error;
  }

  await acquireSlot();

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });

    if (response.status === 429) {
      providerCooldownUntil = Date.now() + 60 * 1000;

      const error = new Error(
        "WeatherAPI rate limit reached."
      );

      error.status = 503;
      throw error;
    }

    const result = await response.json();

    if (!response.ok || result.error) {
      const error = new Error(
        result.error?.message || `WeatherAPI returned ${response.status}`
      );

      error.status = response.status;
      throw error;
    }

    return result;

  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("WeatherAPI request timed out.");
    }

    throw error;

  } finally {
    clearTimeout(timeout);
    releaseSlot();
  }
}

// Convert WeatherAPI condition codes to approximate WMO codes
function getWeatherCode(code) {
  const mapping = {
    1000: 0,
    1003: 2,
    1006: 3,
    1009: 3,

    1030: 45,
    1135: 45,
    1147: 48,

    1150: 51,
    1153: 53,
    1168: 56,
    1171: 57,

    1063: 61,
    1180: 61,
    1183: 63,
    1186: 63,
    1189: 65,
    1192: 65,
    1195: 65,

    1240: 61,
    1243: 63,
    1246: 65,

    1066: 71,
    1210: 71,
    1213: 73,
    1216: 73,
    1219: 75,
    1222: 75,
    1225: 75,

    1255: 71,
    1258: 75,

    1069: 77,
    1072: 56,
    1204: 66,
    1207: 67,
    1237: 77,
    1261: 77,
    1264: 77,

    1087: 95,
    1273: 95,
    1276: 95,
    1279: 96,
    1282: 99
  };

  return mapping[code] ?? 0;
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "WeatherNow API",
    provider: "WeatherAPI"
  });
});

// Weather endpoint
app.get("/api/weather", async (req, res) => {
  const city = String(req.query.city || "").trim();

  if (!city) {
    return res.status(400).json({
      error: "Please provide a city name."
    });
  }

  if (city.length > 100) {
    return res.status(400).json({
      error: "City name is too long."
    });
  }

  const key = city.toLowerCase();

  // Fresh cache
  const cached = cache.get(key);

  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return res.json({
      ...cached.data,
      cached: true
    });
  }

  try {
    // Prevent duplicate requests for the same city
    let request = inFlight.get(key);

    if (!request) {
      request = (async () => {
        const weatherUrl = new URL(
          "https://api.weatherapi.com/v1/forecast.json"
        );

        weatherUrl.search = new URLSearchParams({
          key: WEATHER_API_KEY,
          q: city,
          days: "5",
          aqi: "no",
          alerts: "no"
        });

        const result = await getJson(weatherUrl);

        const place = result.location;
        const current = result.current;
        const forecastDays = result.forecast.forecastday;

        // Current weather
        const currentData = {
          time: place.localtime.replace(" ", "T"),
          interval: 900,
          temperature_2m: current.temp_c,
          relative_humidity_2m: current.humidity,
          apparent_temperature: current.feelslike_c,
          is_day: current.is_day,
          precipitation: current.precip_mm,
          weather_code: getWeatherCode(current.condition.code),
          wind_speed_10m: current.wind_kph,

          // Additional WeatherAPI information
          weather_description: current.condition.text,
          weather_icon: current.condition.icon,
          provider_code: current.condition.code
        };

        // Five-day forecast
        const dailyData = {
          time: [],
          weather_code: [],
          temperature_2m_max: [],
          temperature_2m_min: [],
          precipitation_probability_max: []
        };

        for (const day of forecastDays) {
          const dayForecast = day.day;

          dailyData.time.push(day.date);

          dailyData.weather_code.push(
            getWeatherCode(dayForecast.condition.code)
          );

          dailyData.temperature_2m_max.push(
            dayForecast.maxtemp_c
          );

          dailyData.temperature_2m_min.push(
            dayForecast.mintemp_c
          );

          dailyData.precipitation_probability_max.push(
            Math.max(
              dayForecast.daily_chance_of_rain || 0,
              dayForecast.daily_chance_of_snow || 0
            )
          );
        }

        const data = {
          location: {
            name: place.name,
            country: place.country,
            admin1: place.region || "",
            latitude: place.lat,
            longitude: place.lon,
            timezone: place.tz_id
          },

          current: currentData,

          currentUnits: {
            time: "iso8601",
            interval: "seconds",
            temperature_2m: "°C",
            relative_humidity_2m: "%",
            apparent_temperature: "°C",
            is_day: "",
            precipitation: "mm",
            weather_code: "wmo code",
            wind_speed_10m: "km/h"
          },

          daily: dailyData,

          dailyUnits: {
            time: "iso8601",
            weather_code: "wmo code",
            temperature_2m_max: "°C",
            temperature_2m_min: "°C",
            precipitation_probability_max: "%"
          },

          fetchedAt: new Date().toISOString()
        };

        cache.set(key, {
          time: Date.now(),
          data
        });

        return data;
      })();

      inFlight.set(key, request);
    }

    const data = await request;

    return res.json(data);

  } catch (error) {
    console.error("Weather route error:", error.message);

    // Return stale cache if available
    const stale = cache.get(key);

    if (
      stale &&
      Date.now() - stale.time < STALE_CACHE_TTL
    ) {
      return res.json({
        ...stale.data,
        cached: true,
        stale: true
      });
    }

    return res.status(error.status || 502).json({
      error: error.status === 404
        ? error.message
        : "Unable to retrieve weather right now. Please try again."
    });

  } finally {
    inFlight.delete(key);
  }
});

app.listen(PORT, () => {
  console.log(`WeatherNow API running on port ${PORT}`);
});