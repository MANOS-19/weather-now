import React,{ useEffect, useState } from "react";
import { Search, MapPin, Wind, Droplets, Thermometer, Sunrise, CloudSun, Cloud, Sun, CloudRain, CloudSnow, CloudLightning, LoaderCircle } from "lucide-react";

const API = "https://weather-now-api-pxpl.onrender.com";
function weatherLabel(code) {
  if (code === 0) return "Clear sky";
  if ([1,2,3].includes(code)) return code === 1 ? "Mainly clear" : code === 2 ? "Partly cloudy" : "Overcast";
  if ([45,48].includes(code)) return "Fog";
  if ([51,53,55,56,57].includes(code)) return "Drizzle";
  if ([61,63,65,66,67,80,81,82].includes(code)) return "Rain";
  if ([71,73,75,77,85,86].includes(code)) return "Snow";
  if ([95,96,99].includes(code)) return "Thunderstorm";
  return "Weather";
}
function WeatherIcon({ code, size=34 }) {
  if ([0,1].includes(code)) return <Sun size={size}/>;
  if ([2,3,45,48].includes(code)) return <CloudSun size={size}/>;
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return <CloudRain size={size}/>;
  if ([71,73,75,77,85,86].includes(code)) return <CloudSnow size={size}/>;
  if ([95,96,99].includes(code)) return <CloudLightning size={size}/>;
  return <Cloud size={size}/>;
}
function dayName(date, index) {
  return index === 0 ? "Today" : new Date(`${date}T12:00:00`).toLocaleDateString("en", { weekday: "short" });
}
export default function App() {
  const [city, setCity] = useState("Chennai");
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState(() => JSON.parse(localStorage.getItem("weathernow-recent") || '["Chennai","Bengaluru","Mumbai"]'));

  async function searchWeather(value = query) {
    const target = value.trim();
    if (!target) { setError("Enter a city name to search."); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(`${API}/api/weather?city=${encodeURIComponent(target)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load weather.");
      setData(result); setCity(result.location.name); setQuery("");
      const next = [result.location.name, ...recent.filter(x => x.toLowerCase() !== result.location.name.toLowerCase())].slice(0,5);
      setRecent(next); localStorage.setItem("weathernow-recent", JSON.stringify(next));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { searchWeather("Chennai"); }, []);
  const current = data?.current;
  const daily = data?.daily;
  return <div className="weather-app">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><CloudSun size={21}/></span> weather<span>now.</span></a><div className="top-note">A little more clarity in your day.</div><span className="live-pill"><i/> LIVE FORECAST</span></header>
    <main className="weather-main">
      <section className="intro"><div><p className="eyebrow">YOUR DAILY WEATHER COMPANION</p><h1>Know the day.<br/><em>Plan your moments.</em></h1></div><p className="intro-copy">Simple, thoughtful forecasts for wherever life takes you.</p></section>
      <form className="search" onSubmit={e=>{e.preventDefault();searchWeather();}}><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search a city — e.g. Chennai"/><button disabled={loading}>{loading?<LoaderCircle className="spin" size={17}/>: "Search"}</button></form>
      {error && <div className="error">{error}</div>}
      {data && current && <><section className="current-card">
        <div className="current-info"><div className="place"><MapPin size={16}/>{data.location.name}, {data.location.country}</div><div className="temperature">{Math.round(current.temperature_2m)}<sup>°</sup></div><div className="condition">{weatherLabel(current.weather_code)}</div><div className="feels">Feels like {Math.round(current.apparent_temperature)}°</div></div>
        <div className="weather-art"><div className="sun-halo"/><WeatherIcon code={current.weather_code} size={118}/><span>{current.is_day ? "DAYTIME" : "NIGHTTIME"}</span></div>
        <div className="metrics"><div><Thermometer/><span>FEELS LIKE</span><b>{Math.round(current.apparent_temperature)}°C</b></div><div><Droplets/><span>HUMIDITY</span><b>{current.relative_humidity_2m}%</b></div><div><Wind/><span>WIND SPEED</span><b>{Math.round(current.wind_speed_10m)} km/h</b></div></div>
      </section>
      <section className="forecast-section"><div className="section-head"><div><p className="eyebrow">LOOKING AHEAD</p><h2>5-day forecast</h2></div><span>DAILY OUTLOOK</span></div><div className="forecast-grid">{daily.time.map((date,i)=><article className={`forecast-day ${i===0?"today":""}`} key={date}><span>{dayName(date,i)}</span><WeatherIcon code={daily.weather_code[i]} size={31}/><b>{Math.round(daily.temperature_2m_max[i])}°</b><small>{Math.round(daily.temperature_2m_min[i])}°</small><p>{weatherLabel(daily.weather_code[i])}</p><div className="rain-chance"><Droplets size={12}/>{daily.precipitation_probability_max?.[i] ?? 0}%</div></article>)}</div></section></>}
      <section className="recent"><span>RECENT SEARCHES</span><div>{recent.map(item=><button key={item} onClick={()=>searchWeather(item)}>{item}</button>)}</div></section>
      <footer>Weather data provided by Open-Meteo · Designed to make every day a little clearer.</footer>
    </main>
  </div>;
}
