import { useState, useCallback } from 'react';

const API_URL = import.meta.env.PROD 
  ? 'https://global-relocation-intelligence-engine.onrender.com/api/analyze' 
  : 'http://localhost:3001/api/analyze';

// ─── Utility Helpers ──────────────────────────────────────────────────────────

function scoreColor(score) {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 45) return 'bg-amber-400';
  return 'bg-red-500';
}

function scoreTextColor(score) {
  if (score >= 70) return 'text-emerald-600';
  if (score >= 45) return 'text-amber-600';
  return 'text-red-600';
}

function scoreBadgeColor(score) {
  if (score >= 70) return 'bg-emerald-100 text-emerald-800 border-emerald-300';
  if (score >= 45) return 'bg-amber-100 text-amber-800 border-amber-300';
  return 'bg-red-100 text-red-800 border-red-300';
}

function scoreLabel(score) {
  if (score >= 70) return 'Excellent';
  if (score >= 55) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Poor';
}

function aqiInfo(aqi) {
  if (aqi <= 50)  return { label: 'Good',       color: 'text-emerald-600' };
  if (aqi <= 100) return { label: 'Moderate',   color: 'text-yellow-600'  };
  if (aqi <= 150) return { label: 'USG',         color: 'text-orange-500'  };
  if (aqi <= 200) return { label: 'Unhealthy',  color: 'text-red-500'     };
  return           { label: 'Hazardous',  color: 'text-red-700'     };
}

// ─── Client-side Re-Scoring (mirrors backend math exactly) ───────────────────

function clientReScore(rawResults, riskTolerance, duration) {
  return rawResults.map(r => {
    let adjTravel = r.rawScores.travelRisk;
    let adjEnv    = r.rawScores.envScore;
    const adjHealth = r.rawScores.healthScore;

    if (riskTolerance === 'Low') {
      adjTravel = Math.max(0, 100 - (100 - adjTravel) * 1.5);
    }
    if (riskTolerance === 'High') {
      adjEnv = Math.min(100, 100 - (100 - adjEnv) * 0.5);
    }

    const weights = duration === 'Long-term'
      ? { travel: 0.20, health: 0.60, env: 0.20 }
      : { travel: 0.35, health: 0.30, env: 0.35 };

    const finalScore = Math.round(
      (adjTravel * weights.travel + adjHealth * weights.health + adjEnv * weights.env) * 10
    ) / 10;

    return {
      ...r,
      scores: {
        travelRisk:  Math.round(adjTravel  * 10) / 10,
        healthScore: Math.round(adjHealth  * 10) / 10,
        envScore:    Math.round(adjEnv     * 10) / 10,
        finalScore,
      },
      weights,
    };
  }).sort((a, b) => b.scores.finalScore - a.scores.finalScore);
}

// ─── Radar / Spider Chart (pure SVG — no external library) ───────────────────

function RadarChart({ scores, size = 120 }) {
  const cx = size / 2, cy = size / 2, r = size * 0.36;
  const axes = [
    { key: 'travelRisk',  label: '✈️',  sublabel: 'Travel'  },
    { key: 'healthScore', label: '🏥', sublabel: 'Health'  },
    { key: 'envScore',    label: '🌿', sublabel: 'Env'     },
  ];
  const n = axes.length;
  const pt = (i, scale) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return { x: cx + r * scale * Math.cos(angle), y: cy + r * scale * Math.sin(angle) };
  };
  const dataPath = axes
    .map((a, i) => pt(i, (scores[a.key] ?? 0) / 100))
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ') + ' Z';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map(level => (
        <circle key={level} cx={cx} cy={cy} r={r * level}
          fill="none" stroke="#e2e8f0" strokeWidth="0.8" strokeDasharray="3,2" />
      ))}
      {axes.map((a, i) => {
        const end = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#cbd5e1" strokeWidth="1" />;
      })}
      <path d={dataPath} fill="rgba(99,102,241,0.18)" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />
      {axes.map((a, i) => {
        const dp = pt(i, (scores[a.key] ?? 0) / 100);
        return <circle key={i} cx={dp.x} cy={dp.y} r={3} fill="#6366f1" />;
      })}
      {axes.map((a, i) => {
        const lp = pt(i, 1.3);
        return (
          <text key={i} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
            fontSize="9" fill="#64748b" fontWeight="600">
            {a.label} {a.sublabel}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Score Bar ────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, icon }) {
  const color   = scoreColor(value ?? 0);
  const tcolor  = scoreTextColor(value ?? 0);
  const display = value != null ? value.toFixed(1) : 'N/A';
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-medium text-gray-600 flex items-center gap-1">{icon} {label}</span>
        <span className={`text-xs font-bold ${tcolor}`}>{display}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
        <div className={`${color} h-2.5 rounded-full transition-all duration-700`}
          style={{ width: `${Math.min(100, value ?? 0)}%` }} />
      </div>
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ label, variant = 'gray' }) {
  const map = { gray: 'bg-gray-100 text-gray-600', blue: 'bg-blue-100 text-blue-700' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[variant] ?? map.gray}`}>{label}</span>;
}

// ─── Weight Breakdown (expandable) ───────────────────────────────────────────

function WeightBreakdown({ result }) {
  const [open, setOpen] = useState(false);
  const { scores, weights } = result;
  const rows = [
    { icon: '✈️', label: 'Travel Risk Safety',    score: scores.travelRisk,  weight: weights.travel  },
    { icon: '🏥', label: 'Health Infrastructure', score: scores.healthScore, weight: weights.health  },
    { icon: '🌿', label: 'Env Stability',          score: scores.envScore,    weight: weights.env     },
  ];
  return (
    <div className="mt-3">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-3 py-2 transition font-semibold">
        <span>📐 How was this score calculated?</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-2 bg-gray-50 rounded-xl border border-gray-200 p-3">
          <p className="text-xs text-gray-400 mb-2">
            Final Score = Σ (component × weight). Weights shift dynamically based on Risk Tolerance & Duration.
          </p>
          {rows.map(c => (
            <div key={c.label} className="flex items-center gap-2 text-xs mb-1.5">
              <span className="w-5">{c.icon}</span>
              <span className="w-36 text-gray-700 font-medium">{c.label}</span>
              <span className={`w-10 font-bold ${scoreTextColor(c.score)}`}>{c.score.toFixed(1)}</span>
              <span className="text-gray-400 text-xs">×</span>
              <span className="w-8 text-indigo-600 font-bold">{(c.weight * 100).toFixed(0)}%</span>
              <span className="text-gray-400 text-xs">=</span>
              <span className="font-bold text-gray-800">{(c.score * c.weight).toFixed(2)} pts</span>
            </div>
          ))}
          <div className="border-t border-gray-200 pt-2 flex items-center gap-2 text-xs font-bold">
            <span className="w-5">🎯</span>
            <span className="w-36 text-gray-700">Final Score</span>
            <span className={`w-10 ${scoreTextColor(scores.finalScore)}`}>{scores.finalScore}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Country Card ─────────────────────────────────────────────────────────────

function CountryCard({ result, rank }) {
  const { scores } = result;
  const rankRing = ['ring-yellow-400 bg-yellow-50', 'ring-gray-300 bg-gray-50', 'ring-orange-300 bg-orange-50'];
  const ringClass = rankRing[rank - 1] || 'ring-gray-200 bg-white';
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;

  return (
    <div className={`rounded-2xl ring-2 ${ringClass} p-5 shadow-sm hover:shadow-lg transition-all duration-300`}>

      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-2xl">{medal}</span>
            <h2 className="text-xl font-bold text-gray-900">{result.countryName}</h2>
            {result.fromCache && (
              <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-medium">⚡ cached</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {result.capital  !== 'N/A' && <Badge label={`🏛 ${result.capital}`}  variant="blue" />}
            {result.currency !== 'N/A' && <Badge label={`💱 ${result.currency}`} />}
            {result.population && <Badge label={`👥 ${(result.population / 1e6).toFixed(1)}M`} />}
          </div>
        </div>

        {/* Radar + Badge */}
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <RadarChart scores={scores} size={110} />
          <div className={`flex flex-col items-center justify-center rounded-2xl border-2 px-3 py-2 min-w-16 ${scoreBadgeColor(scores.finalScore)}`}>
            <span className="text-2xl font-extrabold leading-none">{scores.finalScore}</span>
            <span className="text-xs font-semibold mt-0.5">{scoreLabel(scores.finalScore)}</span>
          </div>
        </div>
      </div>

      {/* Score bars */}
      <div className="mb-3">
        <ScoreBar label="Travel Risk Safety"    value={scores.travelRisk}  icon="✈️" />
        <ScoreBar label="Health Infrastructure" value={scores.healthScore} icon="🏥" />
        <ScoreBar label="Environmental Stability" value={scores.envScore}  icon="🌿" />
      </div>

      {/* Data chips */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
        {result.temperature != null && (
          <div className="bg-white rounded-lg p-2 border border-gray-100 text-center">
            <div className="text-xs text-gray-400">🌡 Temp</div>
            <div className="font-bold text-gray-800">{result.temperature}°C</div>
          </div>
        )}
        {result.aqi != null ? (
          <div className="bg-white rounded-lg p-2 border border-gray-100 text-center">
            <div className="text-xs text-gray-400">💨 AQI</div>
            <div className={`font-bold ${aqiInfo(result.aqi).color}`}>{result.aqi}</div>
            <div className={`text-xs ${aqiInfo(result.aqi).color}`}>{aqiInfo(result.aqi).label}</div>
          </div>
        ) : (
          <div className="bg-white rounded-lg p-2 border border-gray-100 text-center opacity-40">
            <div className="text-xs text-gray-400">💨 AQI</div>
            <div className="text-xs">N/A</div>
          </div>
        )}
        {result.lifeExpectancy != null && (
          <div className="bg-white rounded-lg p-2 border border-gray-100 text-center">
            <div className="text-xs text-gray-400">❤️ Life Exp</div>
            <div className="font-bold text-gray-800">{result.lifeExpectancy.toFixed(1)} yrs</div>
          </div>
        )}
        {result.advisoryScore != null && (
          <div className="bg-white rounded-lg p-2 border border-gray-100 text-center">
            <div className="text-xs text-gray-400">🚨 Advisory</div>
            <div className={`font-bold ${result.advisoryScore >= 3.5 ? 'text-red-600' : result.advisoryScore >= 2.5 ? 'text-amber-600' : 'text-emerald-700'}`}>
              {result.advisoryScore.toFixed(1)}/5
            </div>
          </div>
        )}
        {result.healthcareExpenditure != null && (
          <div className="bg-white rounded-lg p-2 border border-gray-100 text-center">
            <div className="text-xs text-gray-400">🏥 Health$</div>
            <div className="font-bold text-gray-800">{result.healthcareExpenditure.toFixed(1)}% GDP</div>
          </div>
        )}
      </div>

      {/* Reasoning */}
      <div className="bg-indigo-50 rounded-xl p-3 mb-2 border border-indigo-100">
        <p className="text-xs text-indigo-700 leading-relaxed">
          <span className="font-semibold">🧠 Analysis: </span>{result.reasoningSummary}
        </p>
      </div>

      {/* Expandable weight breakdown */}
      <WeightBreakdown result={result} />

      {/* Warnings */}
      {result.warnings?.length > 0 && (
        <div className="space-y-1 mt-2">
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
              ⚠️ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Side-by-Side Comparison Table ───────────────────────────────────────────

function ComparisonTable({ results }) {
  const [open, setOpen] = useState(false);
  const metrics = [
    { label: '🎯 Final Score',       get: r => r.scores.finalScore        },
    { label: '✈️ Travel Risk',       get: r => r.scores.travelRisk        },
    { label: '🏥 Health Score',      get: r => r.scores.healthScore       },
    { label: '🌿 Env Score',         get: r => r.scores.envScore          },
    { label: '🌡 Temp (°C)',         get: r => r.temperature              },
    { label: '💨 AQI',              get: r => r.aqi                      },
    { label: '❤️ Life Exp (yrs)',   get: r => r.lifeExpectancy            },
    { label: '🏥 Health Exp (%GDP)',  get: r => r.healthcareExpenditure    },
    { label: '🚨 Advisory',         get: r => r.advisoryScore            },
  ];

  return (
    <div className="mb-6">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl px-5 py-3 text-white font-semibold transition text-sm">
        <span>📊 Side-by-Side Comparison Table</span>
        <span className="text-slate-400">{open ? '▲ Hide' : '▼ Show'}</span>
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-slate-800/80">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left text-slate-400 font-semibold">Metric</th>
                {results.map((r, i) => (
                  <th key={r.countryName} className="px-4 py-3 text-center font-bold text-white">
                    {['🥇','🥈','🥉'][i] || `#${i+1}`} {r.countryName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => {
                const vals = results.map(r => m.get(r));
                const nums = vals.filter(v => v != null);
                const best  = nums.length > 1 ? Math.max(...nums) : null;
                const worst = nums.length > 1 ? Math.min(...nums) : null;
                return (
                  <tr key={m.label} className="border-b border-white/5 hover:bg-white/5 transition">
                    <td className="px-4 py-2.5 text-slate-400 font-medium">{m.label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={`px-4 py-2.5 text-center font-semibold
                        ${v === best ? 'text-emerald-400' : v === worst ? 'text-red-400' : 'text-slate-300'}`}>
                        {v != null ? (typeof v === 'number' ? v.toFixed(1) : v) : '—'}
                        {v === best && nums.length > 1 && ' ✓'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Export JSON Button ───────────────────────────────────────────────────────

function ExportButton({ results, meta, riskTolerance, duration }) {
  const handle = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      config: { riskTolerance, duration },
      meta,
      results: results.map((r, i) => ({
        rank: i + 1,
        countryName: r.countryName,
        capital: r.capital,
        scores: r.scores,
        weights: r.weights,
        rawData: {
          temperature: r.temperature, aqi: r.aqi,
          lifeExpectancy: r.lifeExpectancy, healthcareExpenditure: r.healthcareExpenditure,
          advisoryScore: r.advisoryScore, advisoryMessage: r.advisoryMessage,
          population: r.population, currency: r.currency,
        },
        reasoningSummary: r.reasoningSummary,
        warnings: r.warnings,
      })),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = `relocation-report-${Date.now()}.json`;
    a.click();
  };
  return (
    <button onClick={handle}
      className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-300 hover:text-white transition font-medium">
      ⬇️ Export Full JSON Report
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [countries,     setCountries]     = useState(['Canada', 'Japan', 'Brazil']);
  const [riskTolerance, setRiskTolerance] = useState('Moderate');
  const [duration,      setDuration]      = useState('Short-term');
  const [loading,       setLoading]       = useState(false);
  const [results,       setResults]       = useState(null);
  const [rawResults,    setRawResults]    = useState(null);
  const [meta,          setMeta]          = useState(null);
  const [error,         setError]         = useState(null);
  const [responseTime,  setResponseTime]  = useState(null);
  const [activeRisk,    setActiveRisk]    = useState('Moderate');
  const [activeDuration,setActiveDuration]= useState('Short-term');

  const addCountry    = () => setCountries(p => [...p, '']);
  const removeCountry = i  => setCountries(p => p.filter((_, idx) => idx !== i));
  const updateCountry = (i, v) => setCountries(p => p.map((c, idx) => idx === i ? v : c));

  const filledCount = countries.map(c => c.trim()).filter(Boolean).length;

  const handleSubmit = useCallback(async () => {
    const valid = countries.map(c => c.trim()).filter(Boolean);
    if (valid.length < 3) { setError('Please enter at least 3 countries to analyze.'); return; }

    setLoading(true); setError(null); setResults(null); setRawResults(null);
    setMeta(null); setResponseTime(null);
    const t0 = Date.now();

    try {
      const res  = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countries: valid, riskTolerance, duration }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');

      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      // Attach rawScores so live re-score works without re-fetching
      const enriched = data.results.map(r => ({ ...r, rawScores: { ...r.scores } }));
      const sorted   = [...enriched].sort((a, b) => b.scores.finalScore - a.scores.finalScore);

      setResults(sorted);
      setRawResults(enriched);
      setMeta(data.meta);
      setResponseTime(elapsed);
      setActiveRisk(riskTolerance);
      setActiveDuration(duration);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [countries, riskTolerance, duration]);

  // Instant re-rank without re-fetching API
  const handleReScore = (newRisk, newDuration) => {
    if (!rawResults) return;
    setResults(clientReScore(rawResults, newRisk, newDuration));
    setActiveRisk(newRisk);
    setActiveDuration(newDuration);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-gray-100">

      {/* ── Header ── */}
      <div className="text-center pt-12 pb-8 px-4">
        <div className="inline-flex items-center gap-2 bg-indigo-600/20 border border-indigo-500/30 rounded-full px-4 py-1.5 mb-4 text-indigo-300 text-sm">
          🌐 Real-Time APIs • Min-Max Normalization • Dynamic Weighted Scoring
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-3 tracking-tight">
          Global Relocation &amp;<span className="text-indigo-400"> Travel</span> Intelligence
        </h1>
        <p className="text-slate-400 text-lg max-w-xl mx-auto">
          Compare countries across health, safety, environment, and travel risk using live public data.
        </p>
      </div>

      {/* ── Form ── */}
      <div className="max-w-3xl mx-auto px-4 mb-10">
        <div className="bg-white/5 backdrop-blur rounded-3xl border border-white/10 p-6 sm:p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-5">Configure Your Analysis</h2>

          {/* Countries */}
          <div className="mb-5">
            <label className="text-sm font-medium text-slate-400 mb-2 block">
              Countries to Compare
              <span className="ml-2 text-xs text-slate-500">(minimum 3)</span>
            </label>
            <div className="space-y-2">
              {countries.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" value={c} onChange={e => updateCountry(i, e.target.value)}
                    placeholder={`Country ${i + 1}`}
                    className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />
                  {countries.length > 3 && (
                    <button onClick={() => removeCountry(i)}
                      className="px-3 py-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition font-bold">✕</button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button onClick={addCountry} className="text-sm text-indigo-400 hover:text-indigo-300 transition">
                + Add country
              </button>
              <span className={`text-xs font-semibold ${filledCount >= 3 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {filledCount >= 3 ? '✓' : '⚠️'} {filledCount}/3 minimum filled
              </span>
            </div>
          </div>

          {/* Risk + Duration */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-sm font-medium text-slate-400 mb-2 block">Risk Tolerance</label>
              <select value={riskTolerance} onChange={e => setRiskTolerance(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="Low">🛡 Low — Amplifies risk penalties</option>
                <option value="Moderate">⚖️ Moderate — Balanced weights</option>
                <option value="High">🚀 High — Reduces env penalties</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-400 mb-2 block">Duration</label>
              <select value={duration} onChange={e => setDuration(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="Short-term">✈️ Short-term — Env+Travel = 70%</option>
                <option value="Long-term">🏡 Long-term — Health = 60%</option>
              </select>
            </div>
          </div>

          {/* Submit */}
          <button onClick={handleSubmit} disabled={filledCount < 3 || loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-all text-base shadow-lg shadow-indigo-600/30">
            {loading
              ? <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Fetching &amp; Analyzing...
                </span>
              : '🔍 Analyze Countries'}
          </button>

          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-3 text-sm">
              ❌ {error}
            </div>
          )}
        </div>
      </div>

      {/* ── Results ── */}
      {results && (
        <div className="max-w-6xl mx-auto px-4 pb-16">

          {/* Stats bar */}
          <div className="flex flex-wrap gap-3 justify-center mb-6">
            <span className="bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-sm text-slate-300">
              📊 {results.length} countries ranked
            </span>
            {responseTime && (
              <span className="bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 text-sm text-emerald-400 font-semibold">
                ⚡ Response time: {responseTime}s
              </span>
            )}
            <span className="bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-sm text-slate-300">
              🗄 {meta?.cacheHits} cache hits · {meta?.cacheMisses} API fetches
            </span>
            <span className="bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-sm text-slate-300">
              🎯 {activeRisk} risk · {activeDuration}
            </span>
            {meta?.errors?.length > 0 && (
              <span className="bg-red-500/10 border border-red-500/20 rounded-full px-4 py-1.5 text-sm text-red-400">
                ⚠️ {meta.errors.length} failed
              </span>
            )}
          </div>

          {/* ── Live Re-Score Panel ── */}
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-4 mb-6">
            <p className="text-xs text-indigo-300 font-semibold uppercase tracking-wide mb-3">
              ⚡ Live Re-Score — instantly re-rank without re-fetching data
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Risk Tolerance</label>
                <select value={activeRisk} onChange={e => handleReScore(e.target.value, activeDuration)}
                  className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="Low">🛡 Low</option>
                  <option value="Moderate">⚖️ Moderate</option>
                  <option value="High">🚀 High</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Duration</label>
                <select value={activeDuration} onChange={e => handleReScore(activeRisk, e.target.value)}
                  className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="Short-term">✈️ Short-term</option>
                  <option value="Long-term">🏡 Long-term</option>
                </select>
              </div>
              <p className="text-xs text-slate-500 max-w-sm">
                Rankings update instantly — demonstrates the dynamic weighting logic live. No extra API calls made.
              </p>
            </div>
          </div>

          {/* Failed */}
          {meta?.errors?.map(e => (
            <div key={e.country} className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
              ❌ <strong>{e.country}</strong>: {e.error}
            </div>
          ))}

          {/* Comparison Table */}
          <ComparisonTable results={results} />

          {/* Export */}
          <div className="flex justify-end mb-5">
            <ExportButton results={results} meta={meta} riskTolerance={activeRisk} duration={activeDuration} />
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {results.map((r, i) => (
              <CountryCard key={r.countryName} result={r} rank={i + 1} />
            ))}
          </div>
        </div>
      )}

      {/* ── Loading Overlay ── */}
      {loading && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-3xl p-10 flex flex-col items-center gap-4 shadow-2xl border border-white/10 max-w-sm w-full mx-4">
            <svg className="animate-spin h-12 w-12 text-indigo-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <div className="text-white font-semibold text-lg text-center">Fetching real-time data...</div>
            <div className="w-full space-y-1.5">
              {['REST Countries API', 'World Bank (Life Exp + Healthcare)', 'Open-Meteo (Weather + AQI)', 'Travel Advisory API'].map(api => (
                <div key={api} className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1.5 text-xs text-slate-400">
                  <svg className="animate-spin h-3 w-3 text-indigo-400 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  {api}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 text-center">All APIs queried concurrently via Promise.all()</p>
          </div>
        </div>
      )}
    </div>
  );
}