const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const NodeCache = require('node-cache');
const axios = require('axios');
const { computeCountryScore } = require('./scoring');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ─── External API Fetchers ───────────────────────────────────────────────────

async function fetchRestCountries(countryName) {
  const t0 = Date.now();
  const url = `https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fullText=true`;
  const res = await axios.get(url, { timeout: 8000 });
  console.log(`[REST Countries] ${countryName} → ${Date.now() - t0}ms`);
  const d = res.data[0];
  return {
    capital: d.capital?.[0] ?? 'N/A',
    population: d.population ?? null,
    currency: Object.values(d.currencies ?? {})[0]?.name ?? 'N/A',
    latlng: d.latlng ?? [0, 0],
    area: d.area ?? null,
  };
}

async function fetchWorldBank(countryIso2) {
  const t0 = Date.now();
  const base = 'https://api.worldbank.org/v2/country';
  const [lifeRes, healthRes] = await Promise.all([
    axios.get(`${base}/${countryIso2}/indicator/SP.DYN.LE00.IN?format=json&mrv=1`, { timeout: 8000 }),
    axios.get(`${base}/${countryIso2}/indicator/SH.XPD.CHEX.GD.ZS?format=json&mrv=1`, { timeout: 8000 }),
  ]);
  console.log(`[World Bank] ${countryIso2} → ${Date.now() - t0}ms`);
  const lifeExp = lifeRes.data?.[1]?.[0]?.value ?? null;
  const healthExp = healthRes.data?.[1]?.[0]?.value ?? null;
  return { lifeExpectancy: lifeExp, healthcareExpenditure: healthExp };
}

async function fetchWeatherAndAQI(lat, lon) {
  const t0 = Date.now();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
  const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,us_aqi`;
  const [weatherRes, aqiRes] = await Promise.allSettled([
    axios.get(url, { timeout: 8000 }),
    axios.get(aqiUrl, { timeout: 8000 }),
  ]);
  console.log(`[Open-Meteo] (${lat},${lon}) → ${Date.now() - t0}ms`);
  const temp = weatherRes.status === 'fulfilled' ? weatherRes.value.data?.current?.temperature_2m : null;
  const aqi = aqiRes.status === 'fulfilled' ? aqiRes.value.data?.current?.us_aqi : null;
  return { temperature: temp, aqi, aqiUnavailable: aqi === null };
}

async function fetchTravelAdvisory(countryIso2) {
  const t0 = Date.now();
  const url = `https://www.travel-advisory.info/api?countrycode=${countryIso2.toUpperCase()}`;
  const res = await axios.get(url, { timeout: 8000 });
  console.log(`[Travel Advisory] ${countryIso2} → ${Date.now() - t0}ms`);
  const entry = res.data?.data?.[countryIso2.toUpperCase()];
  return {
    advisoryScore: entry?.advisory?.score ?? null,
    advisoryMessage: entry?.advisory?.message ?? 'N/A',
  };
}

// ─── Country ISO2 helper via REST Countries ──────────────────────────────────

async function getCountryMeta(countryName) {
  const res = await axios.get(
    `https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fullText=true`,
    { timeout: 8000 }
  );
  const d = res.data[0];
  return {
    iso2: d.cca2,
    capital: d.capital?.[0] ?? 'N/A',
    population: d.population ?? null,
    currency: Object.values(d.currencies ?? {})[0]?.name ?? 'N/A',
    latlng: d.latlng ?? [0, 0],
    area: d.area ?? null,
  };
}

// ─── Per-Country Aggregator ───────────────────────────────────────────────────

async function aggregateCountryData(countryName) {
  const warnings = [];
  let meta, wb, weather, advisory;

  try {
    meta = await getCountryMeta(countryName);
  } catch (e) {
    console.error(`[ERROR] REST Countries failed for "${countryName}": ${e.message}`);
    throw new Error(`Country "${countryName}" not found.`);
  }

  // Parallel fetch of remaining APIs
  const [wbResult, weatherResult, advisoryResult] = await Promise.allSettled([
    fetchWorldBank(meta.iso2),
    fetchWeatherAndAQI(meta.latlng[0], meta.latlng[1]),
    fetchTravelAdvisory(meta.iso2),
  ]);

  if (wbResult.status === 'fulfilled') {
    wb = wbResult.value;
  } else {
    console.error(`[WARN] World Bank failed for ${countryName}: ${wbResult.reason?.message}`);
    warnings.push('Health data unavailable (World Bank API)');
    wb = { lifeExpectancy: null, healthcareExpenditure: null };
  }

  if (weatherResult.status === 'fulfilled') {
    weather = weatherResult.value;
    if (weather.aqiUnavailable) warnings.push('AQI data unavailable for this region');
  } else {
    console.error(`[WARN] Weather/AQI failed for ${countryName}: ${weatherResult.reason?.message}`);
    warnings.push('Weather/AQI data unavailable');
    weather = { temperature: null, aqi: null, aqiUnavailable: true };
  }

  if (advisoryResult.status === 'fulfilled') {
    advisory = advisoryResult.value;
  } else {
    console.error(`[WARN] Travel Advisory failed for ${countryName}: ${advisoryResult.reason?.message}`);
    warnings.push('Travel advisory data unavailable');
    advisory = { advisoryScore: null, advisoryMessage: 'N/A' };
  }

  return {
    countryName,
    iso2: meta.iso2,
    capital: meta.capital,
    population: meta.population,
    currency: meta.currency,
    area: meta.area,
    latlng: meta.latlng,
    ...wb,
    ...weather,
    ...advisory,
    warnings,
  };
}

// ─── Main Endpoint ────────────────────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const { countries, riskTolerance, duration } = req.body;

  if (!Array.isArray(countries) || countries.length < 3) {
    return res.status(400).json({ error: 'Provide at least 3 countries.' });
  }
  if (!['Low', 'Moderate', 'High'].includes(riskTolerance)) {
    return res.status(400).json({ error: 'riskTolerance must be Low, Moderate, or High.' });
  }
  if (!['Short-term', 'Long-term'].includes(duration)) {
    return res.status(400).json({ error: 'duration must be Short-term or Long-term.' });
  }

  // ── Remove duplicate country names (case-insensitive) ──
  // Safety net in case frontend sends duplicates
  const uniqueCountries = [...new Map(
    countries.map(c => [c.trim().toLowerCase(), c.trim()])
  ).values()];
  console.log(`[INFO] Countries after dedup: ${uniqueCountries.join(', ')}`);

  let cacheHits = 0;
  let cacheMisses = 0;
  const errors = [];

  // Determine which countries need fetching
  const fetchPromises = uniqueCountries.map(async (name) => {
    const key = `country:${name.trim().toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) {
      console.log(`[CACHE HIT] ${name}`);
      cacheHits++;
      return { ...cached, fromCache: true };
    }
    console.log(`[CACHE MISS] ${name} – fetching from APIs`);
    cacheMisses++;
    try {
      const data = await aggregateCountryData(name.trim());
      cache.set(key, data); // Only cache successful responses
      return { ...data, fromCache: false };
    } catch (err) {
      errors.push({ country: name, error: err.message });
      return null;
    }
  });

  const rawResults = await Promise.all(fetchPromises);
  const validResults = rawResults.filter(Boolean);

  if (validResults.length === 0) {
    return res.status(404).json({ error: 'No valid countries found.', details: errors });
  }

  // Scoring with dynamic weights
  console.log(`[SCORING] Computing scores for ${validResults.length} countries (riskTolerance=${riskTolerance}, duration=${duration})`);
  const scored = computeCountryScore(validResults, riskTolerance, duration);

  // Sort highest to lowest
  scored.sort((a, b) => b.scores.finalScore - a.scores.finalScore);

  return res.json({
    meta: { cacheHits, cacheMisses, errors },
    results: scored,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));