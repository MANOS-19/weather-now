import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET"]
}));

app.use(express.json());

// ========================================
// CACHE CONFIGURATION
// ========================================

const cache = new Map();
const inFlight = new Map();

const CACHE_TTL = 5 * 60 * 1000;       // 5 minutes
const STALE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const REQUEST_TIMEOUT = 12000;

const delay = (ms) =>
  new Promise(resolve => setTimeout(resolve, ms));

// ========================================
// WEATHER API REQUEST HANDLER
// ========================================

async function getJson(url) {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT
    );

    let response;

    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json"
        }
      });

    } catch (error) {
      clearTimeout(timeout);

      // Retry network errors and timeouts
      if (attempt === MAX_ATTEMPTS - 1) {
        throw error;
      }

      const waitTime = 2000 * (attempt + 1);

      console.log(
        `Weather API connection failed. Retrying in ${waitTime}ms`
      );

      await delay(waitTime);
      continue;

    } finally {
      clearTimeout(timeout);
    }

    // Successful response
    if (response.ok) {
      return response.json();
    }

    // Do not retry permanent client errors
    if (
      response.status !== 429 &&
      response.status < 500
    ) {
      throw new Error(
        `Weather provider returned ${response.status}`
      );
    }

    // Retry rate limits and temporary server errors
    if (attempt === MAX_ATTEMPTS - 1) {
      throw new Error(
        `Weather provider returned ${response.status}`
      );
    }

    // Respect Retry-After if available
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfter = Number(retryAfterHeader);

    let waitTime;

    if (response.status === 429) {
      waitTime =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30000)
          : 10000 * (attempt + 1);
    } else {
      waitTime = 2000 * (attempt + 1);
    }

    console.log(
      `Weather provider returned ${response.status}. Retrying in ${waitTime}ms`
    );

    await delay(waitTime);
  }

  throw new Error("Weather provider unavailable");
}

// ========================================
// HEALTH CHECK
// ========================================

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "WeatherNow API"
  });
});

// ========================================
// WEATHER ENDPOINT
// ========================================

app.get("/api/weather", async (req, res) => {
  const city = String(req.query.city || "").trim();

  // Validate city
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

  // ========================================
  // CHECK FRESH CACHE
  // ========================================

  const cached = cache.get(key);

  if (cached && Date.now() - cached.time < CACHE_TTL) {
    console.log(`Serving fresh cached weather for ${city}`);

    return res.json({
      ...cached.data,
      cached: true
    });
  }

  try {
    // ========================================
    // PREVENT DUPLICATE REQUESTS
    // ========================================

    let request = inFlight.get(key);

    if (!request) {
      request = (async () => {

        // ========================================
        // GEOCODING API
        // ========================================

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

        // ========================================
        // WEATHER FORECAST API
        // ========================================

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

        // ========================================
        // FORMAT WEATHER DATA
        // ========================================

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

        // ========================================
        // SAVE TO CACHE
        // ========================================

        cache.set(key, {
          time: Date.now(),
          data
        });

        console.log(`Weather successfully fetched for ${city}`);

        return data;

      })();

      inFlight.set(key, request);
    }

    // Wait for existing or new request
    const data = await request;

    return res.json(data);

  } catch (error) {

    console.error("Weather route error:", error);

    // ========================================
    // STALE CACHE FALLBACK
    // ========================================

    const stale = cache.get(key);

    if (
      stale &&
      Date.now() - stale.time < STALE_CACHE_TTL
    ) {
      console.log(`Serving stale cached weather for ${city}`);

      return res.json({
        ...stale.data,
        cached: true,
        stale: true
      });
    }

    // ========================================
    // ERROR RESPONSE
    // ========================================

    return res.status(error.status || 502).json({
      error: error.status === 404
        ? error.message
        : "Unable to retrieve weather right now. Please try again."
    });

  } finally {
    inFlight.delete(key);
  }
});

// ========================================
// START SERVER
// ========================================

app.listen(PORT, () => {
  console.log(`WeatherNow API running on port ${PORT}`);
});