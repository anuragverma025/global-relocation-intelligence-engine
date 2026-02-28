# Global Relocation & Travel Decision Intelligence Engine

## Project Structure

```
relocation-engine/
├── backend/
│   ├── server.js          ← Express API server + all external API calls
│   ├── scoring.js         ← Min-Max normalization + dynamic weighted scoring
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.jsx         ← Full React dashboard
    │   ├── main.jsx        ← Entry point
    │   └── index.css       ← Tailwind directives
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    └── package.json
```

## Quick Start

### Backend
```bash
cd backend
npm install
npm run dev      # uses nodemon for hot-reload
# Server runs at http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# App runs at http://localhost:5173
```

## API Reference

### POST /api/analyze
```json
{
  "countries": ["Canada", "Japan", "Brazil"],
  "riskTolerance": "Low" | "Moderate" | "High",
  "duration": "Short-term" | "Long-term"
}
```

#### Response
```json
{
  "meta": {
    "cacheHits": 1,
    "cacheMisses": 2,
    "errors": []
  },
  "results": [
    {
      "countryName": "Canada",
      "capital": "Ottawa",
      "population": 38000000,
      "currency": "Canadian dollar",
      "temperature": 2.5,
      "aqi": 18,
      "lifeExpectancy": 82.3,
      "healthcareExpenditure": 10.8,
      "advisoryScore": 1.2,
      "advisoryMessage": "...",
      "warnings": [],
      "scores": {
        "travelRisk": 78.4,
        "healthScore": 81.2,
        "envScore": 72.1,
        "finalScore": 77.8
      },
      "weights": { "travel": 0.35, "health": 0.30, "env": 0.35 },
      "reasoningSummary": "Canada scored 77.8/100. Boosted by strong health infrastructure (81.2/100). Life expectancy: 82.3 years.",
      "fromCache": false
    }
  ]
}
```

## Scoring Algorithm

All raw metrics are normalized via Min-Max normalization to a 0–100 scale before weighting:

```
normalized = ((x - min) / (max - min)) * 100
```

Three component scores feed into the final:
- **Travel Risk Score** – AQI penalty + temperature extreme penalty + advisory risk penalty
- **Health Infrastructure Score** – Life expectancy + healthcare expenditure (GDP%) − population density pressure
- **Environmental Stability Score** – AQI comfort + temperature comfort

### Dynamic Weights

| Config | Travel | Health | Environment |
|--------|--------|--------|-------------|
| Long-term | 20% | **60%** | 20% |
| Short-term | 35% | 30% | 35% |

Risk tolerance modifiers:
- **Low**: Travel risk penalties × 1.5
- **High**: Environmental penalties × 0.5

## External APIs Used

| API | Purpose | Auth Required |
|-----|---------|---------------|
| REST Countries v3.1 | Country metadata | None |
| World Bank API | Life expectancy, healthcare expenditure | None |
| Open-Meteo | Temperature, AQI | None |
| travel-advisory.info | Travel advisory scores | None |
