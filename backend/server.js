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

// Cache configuration
const cache = new Map();
const inFlight = new Map();

const CACHE_TTL = 15 * 60 * 1000;
const STALE_CACHE_TTL = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 12000;

// Global provider cooldown
let providerCooldownUntil = 0;

// Limit simultaneous provider requests
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 2;

async function acquireSlot() {
  while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  activeRequests++;
}

function releaseSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
}

async function getJson(url) {
  if (Date.now() < providerCooldownUntil) {
    const error = new Error("Weather provider is temporarily unavailable.");
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

      const error = new Error("Weather provider rate limit reached.");
      error.status = 503;

      throw error;
    }

    if (!response.ok) {
      throw new Error(`Weather provider returned ${response.status}`);
    }

    return await response.json();

  } finally {
    clearTimeout(timeout);
    releaseSlot();
  }
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "WeatherNow API"
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

  const cached = cache.get(key);

  // Fresh cache
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
        const geoUrl = new URL(
          "https://geocoding-api.open-meteo.com/v1/search"
        );

        geoUrl.search = new URLSearchParams({
          name: city,
          count: "1",
          language: "en",
          format: "json"
        });

        const geo = await getJson(geoUrl);
        const place = geo.results?.[0];

        if (!place) {
          const error = new Error(
            `No location found for "${city}". Try another city.`
          );

          error.status = 404;
          throw error;
        }

        const forecastUrl = new URL(
          "https://api.open-meteo.com/v1/forecast"
        );

        forecastUrl.search = new URLSearchParams({
          latitude: String(place.latitude),
          longitude: String(place.longitude),
          current:
            "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
          daily:
            "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
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