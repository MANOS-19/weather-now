# WeatherNow ☁️

A modern, full-stack weather forecasting application that provides real-time weather information and a five-day forecast for cities around the world.

## Features

- **City Search:** Search for weather information by city name.
- **Current Weather:** View temperature, weather conditions, and feels-like temperature.
- **Weather Details:** Check humidity and wind speed.
- **5-Day Forecast:** View daily weather conditions with maximum and minimum temperatures.
- **Rain Probability:** Check the probability of precipitation for upcoming days.
- **Recent Searches:** Quickly revisit previously searched cities.
- **Responsive Interface:** Clean and user-friendly weather dashboard.
- **Error Handling:** Loading indicators and meaningful error messages.

## Technologies Used

**Frontend**
- React.js
- JavaScript (ES6+)
- Vite
- Lucide React
- CSS3

**Backend**
- Node.js
- Express.js
- REST API

**Weather Data**
- Open-Meteo API

## Project Structure

```text
weather-now/
│
├── backend/
│   ├── server.js
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── style.css
│   ├── index.html
│   └── package.json
│
└── README.md
```

## Installation and Setup

### Prerequisites
- Node.js
- npm
- Git

### 1. Clone the Repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd weather-now
```

### 2. Start the Backend

```bash
cd backend
npm install
npm run dev
```

Backend runs at:

`http://localhost:5000`

### 3. Start the Frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at:

`http://localhost:5173`

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Check backend status |
| GET | `/api/weather?city=Chennai` | Retrieve weather information for a city |

## Weather Data Provider

WeatherNow uses the **Open-Meteo API** for geocoding and weather forecast information.

No API key is required.

Website: https://open-meteo.com/

## Author

**Mano S**

B.Tech – Artificial Intelligence and Machine Learning

---

⭐ If you find this project useful, consider giving it a star!