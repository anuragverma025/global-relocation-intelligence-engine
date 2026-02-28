/**
 * scoring.js — Normalization, Metric Calculation, and Dynamic Weighting
 *
 * MATHEMATICAL STRATEGY: Min-Max Normalization
 * ─────────────────────────────────────────────
 * Raw metrics come from disparate scales:
 *   - Population: hundreds to billions
 *   - AQI: 0 to 500
 *   - Life Expectancy: ~50 to ~90 years
 *   - Healthcare Expenditure: 1% to 20% of GDP
 *   - Travel Advisory Score: 1.0 to 5.0
 *   - Temperature: -30°C to 50°C
 *
 * Min-Max normalization maps any value x to [0, 100]:
 *   normalized = ((x - min) / (max - min)) * 100
 *
 * This ensures no single metric dominates due to its scale.
 * For "penalty" metrics (higher raw = worse), we invert:
 *   invertedNormalized = 100 - normalizedValue
 */

// ─── Known Min/Max bounds for each metric ────────────────────────────────────
const BOUNDS = {
  aqi:                    { min: 0,   max: 500  },
  temperature:            { min: -30, max: 50   },
  advisoryScore:          { min: 1,   max: 5    },
  lifeExpectancy:         { min: 45,  max: 90   },
  healthcareExpenditure:  { min: 0,   max: 20   },
  populationDensity:      { min: 0,   max: 20000 }, // people/km²
};

/**
 * Normalizes a value to [0, 100] given min/max bounds.
 * Clamps the result so out-of-bounds raw values don't break scoring.
 */
function minMaxNormalize(value, min, max) {
  if (value === null || value === undefined || isNaN(value)) return null;
  const clamped = Math.min(Math.max(value, min), max);
  return ((clamped - min) / (max - min)) * 100;
}

/**
 * Inverts a normalized score so that higher raw = lower normalized score.
 * Used for penalty metrics like AQI, advisory risk, temperature extremes.
 */
function invert(normalizedScore) {
  if (normalizedScore === null) return null;
  return 100 - normalizedScore;
}

/**
 * Returns a fallback midpoint if data is missing, to avoid null propagation.
 */
function withFallback(value, fallback = 50) {
  return value !== null && value !== undefined ? value : fallback;
}

// ─── Metric Calculations ──────────────────────────────────────────────────────

/**
 * Travel Risk Score (0-100, higher = safer/better)
 * Penalizes: high temperature extremes, high AQI, high advisory risk.
 *
 * Temperature extreme is defined as deviation from a comfortable 20°C,
 * normalized relative to max deviation of 30°C.
 */
function calcTravelRiskScore(data) {
  // Normalize AQI penalty: high AQI → high raw → inverted to low score
  const aqiPenalty = invert(minMaxNormalize(data.aqi, BOUNDS.aqi.min, BOUNDS.aqi.max));

  // Temperature extreme: distance from 20°C comfort zone
  const tempDeviation = data.temperature !== null ? Math.abs(data.temperature - 20) : null;
  const tempPenalty = invert(minMaxNormalize(tempDeviation, 0, 30));

  // Advisory risk: higher score = more dangerous → invert
  const advisoryPenalty = invert(minMaxNormalize(data.advisoryScore, BOUNDS.advisoryScore.min, BOUNDS.advisoryScore.max));

  // Weighted average of the three penalty components
  const scores = [
    { v: withFallback(aqiPenalty), w: 0.35 },
    { v: withFallback(tempPenalty), w: 0.30 },
    { v: withFallback(advisoryPenalty), w: 0.35 },
  ];

  return scores.reduce((acc, s) => acc + s.v * s.w, 0);
}

/**
 * Health Infrastructure Score (0-100, higher = better)
 * Rewards: high life expectancy, high healthcare expenditure.
 * Penalizes: high population density (system pressure).
 */
function calcHealthScore(data) {
  const lifeExpNorm = minMaxNormalize(data.lifeExpectancy, BOUNDS.lifeExpectancy.min, BOUNDS.lifeExpectancy.max);
  const healthExpNorm = minMaxNormalize(data.healthcareExpenditure, BOUNDS.healthcareExpenditure.min, BOUNDS.healthcareExpenditure.max);

  // Compute population density if area available
  const density = data.population && data.area ? data.population / data.area : null;
  const densityPenalty = invert(minMaxNormalize(density, BOUNDS.populationDensity.min, BOUNDS.populationDensity.max));

  const scores = [
    { v: withFallback(lifeExpNorm), w: 0.45 },
    { v: withFallback(healthExpNorm), w: 0.35 },
    { v: withFallback(densityPenalty), w: 0.20 },
  ];

  return scores.reduce((acc, s) => acc + s.v * s.w, 0);
}

/**
 * Environmental Stability Score (0-100, higher = more stable/pleasant)
 * Assesses: AQI (lower = better), temperature reasonableness.
 * Temperature reward is highest near 20°C, decays as deviation increases.
 */
function calcEnvironmentScore(data) {
  const aqiReward = invert(minMaxNormalize(data.aqi, BOUNDS.aqi.min, BOUNDS.aqi.max));

  // Temperature comfort: 0 deviation = 100, 30°C deviation = 0
  const tempDeviation = data.temperature !== null ? Math.abs(data.temperature - 20) : null;
  const tempComfort = invert(minMaxNormalize(tempDeviation, 0, 30));

  const scores = [
    { v: withFallback(aqiReward), w: 0.55 },
    { v: withFallback(tempComfort), w: 0.45 },
  ];

  return scores.reduce((acc, s) => acc + s.v * s.w, 0);
}

// ─── Dynamic Weighting & Final Score ─────────────────────────────────────────

/**
 * Applies dynamic weights based on user preferences to produce finalSuitabilityScore.
 *
 * Duration logic:
 *   Long-term  → Health gets 60% weight (most important for living quality)
 *   Short-term → Travel Risk + Environment get combined 70% weight
 *
 * RiskTolerance adjustments (applied to raw component scores):
 *   Low       → Travel risk penalties multiplied by 1.5 (more sensitive to risk)
 *   High      → Environmental penalties reduced by 0.5 (more tolerant of environment)
 */
function applyDynamicWeights(travelRisk, healthScore, envScore, riskTolerance, duration) {
  let adjTravelRisk = travelRisk;
  let adjEnvScore = envScore;
  let adjHealthScore = healthScore;

  // ── RiskTolerance Adjustments ──
  if (riskTolerance === 'Low') {
    // Amplify the penalty: a lower travelRisk score gets pushed even lower
    // We invert, scale, then reinvert: penalty = (100 - score), scaled * 1.5
    const penalty = (100 - travelRisk) * 1.5;
    adjTravelRisk = Math.max(0, 100 - penalty);
    console.log(`[SCORING] Low risk tolerance → Travel Risk adjusted from ${travelRisk.toFixed(1)} to ${adjTravelRisk.toFixed(1)}`);
  }
  if (riskTolerance === 'High') {
    // Reduce environmental penalties: env penalty = (100 - envScore) * 0.5
    const penalty = (100 - envScore) * 0.5;
    adjEnvScore = Math.min(100, 100 - penalty);
    console.log(`[SCORING] High risk tolerance → Env Score adjusted from ${envScore.toFixed(1)} to ${adjEnvScore.toFixed(1)}`);
  }

  // ── Duration-Based Weights ──
  let weights;
  if (duration === 'Long-term') {
    // Health dominates for long-term relocation decisions
    weights = { travel: 0.20, health: 0.60, env: 0.20 };
  } else {
    // Short-term: immediate conditions matter most
    weights = { travel: 0.35, health: 0.30, env: 0.35 };
  }

  console.log(`[SCORING] Weights applied (${duration}): travel=${weights.travel}, health=${weights.health}, env=${weights.env}`);

  const finalScore =
    adjTravelRisk * weights.travel +
    adjHealthScore * weights.health +
    adjEnvScore * weights.env;

  return { finalScore, weights, adjTravelRisk, adjHealthScore, adjEnvScore };
}

// ─── Reasoning Summary Generator ─────────────────────────────────────────────

function generateReasoning(countryName, data, scores, riskTolerance, duration) {
  const { travelRisk, healthScore, envScore, finalScore } = scores;
  const parts = [];

  // Strongest positive contributor
  const best = [
    { label: 'strong health infrastructure', val: healthScore },
    { label: 'safe travel conditions', val: travelRisk },
    { label: 'favorable environmental stability', val: envScore },
  ].sort((a, b) => b.val - a.val)[0];

  // Strongest negative contributor
  const worst = [
    { label: 'health infrastructure concerns', val: healthScore },
    { label: 'elevated travel risk', val: travelRisk },
    { label: 'poor environmental conditions', val: envScore },
  ].sort((a, b) => a.val - b.val)[0];

  parts.push(`${countryName} scored ${finalScore.toFixed(1)}/100.`);

  if (best.val > 65) parts.push(`Boosted by ${best.label} (${best.val.toFixed(1)}/100).`);
  if (worst.val < 50) parts.push(`Penalized by ${worst.label} (${worst.val.toFixed(1)}/100).`);

  if (data.aqi !== null && data.aqi > 150) parts.push(`High AQI of ${data.aqi} increased travel and environmental risk penalties.`);
  if (data.advisoryScore !== null && data.advisoryScore >= 3.5) parts.push(`Travel advisory score of ${data.advisoryScore.toFixed(1)} indicates elevated risk.`);
  if (data.lifeExpectancy !== null) parts.push(`Life expectancy: ${data.lifeExpectancy.toFixed(1)} years.`);
  if (riskTolerance === 'Low') parts.push(`Risk penalties amplified (Low tolerance setting).`);
  if (duration === 'Long-term') parts.push(`Health score weighted heavily for long-term suitability.`);
  if (data.warnings?.length > 0) parts.push(`Note: ${data.warnings[0]}`);

  return parts.join(' ');
}

// ─── Main Export ──────────────────────────────────────────────────────────────

function computeCountryScore(countries, riskTolerance, duration) {
  return countries.map((data) => {
    const travelRisk = calcTravelRiskScore(data);
    const healthScore = calcHealthScore(data);
    const envScore = calcEnvironmentScore(data);

    const { finalScore, weights, adjTravelRisk, adjHealthScore, adjEnvScore } =
      applyDynamicWeights(travelRisk, healthScore, envScore, riskTolerance, duration);

    const scores = {
      travelRisk: Math.round(adjTravelRisk * 10) / 10,
      healthScore: Math.round(adjHealthScore * 10) / 10,
      envScore: Math.round(adjEnvScore * 10) / 10,
      finalScore: Math.round(finalScore * 10) / 10,
    };

    const reasoningSummary = generateReasoning(data.countryName, data, scores, riskTolerance, duration);

    console.log(`[SCORING] ${data.countryName}: final=${scores.finalScore}, travel=${scores.travelRisk}, health=${scores.healthScore}, env=${scores.envScore}`);

    return {
      countryName: data.countryName,
      capital: data.capital,
      population: data.population,
      currency: data.currency,
      temperature: data.temperature,
      aqi: data.aqi,
      lifeExpectancy: data.lifeExpectancy,
      healthcareExpenditure: data.healthcareExpenditure,
      advisoryScore: data.advisoryScore,
      advisoryMessage: data.advisoryMessage,
      warnings: data.warnings ?? [],
      scores,
      weights,
      reasoningSummary,
      fromCache: data.fromCache,
    };
  });
}

module.exports = { computeCountryScore };
