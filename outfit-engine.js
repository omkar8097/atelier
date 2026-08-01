// Two ways to get an outfit:
//   1. buildRuleBasedOutfit()  — deterministic, local, no network, "the app's own preferences"
//   2. requestAiOutfit()       — calls Claude with the user's own API key
//
// ---------------------------------------------------------------------------
// UPGRADABILITY NOTES
// ---------------------------------------------------------------------------
// This engine is intentionally config/registry-driven so it can grow without
// rewrites to the core scoring/selection algorithm:
//   - ENGINE_CONFIG holds every tunable number (scoring weights, thresholds,
//     shortlist size). Change behavior by editing one object.
//   - MOOD_PROFILES / WEATHER_RULES / CATEGORY_ROLES are registries, not
//     hardcoded switch statements. Add a new mood, weather bucket, or
//     clothing category via registerMoodProfile() / registerWeatherCondition()
//     / registerCategoryRole() from anywhere (e.g. a future settings screen)
//     without touching this file.
//   - Every outfit object returned (rule-based or AI) carries engine_version
//     and engine_source so the UI (or a future migration) can tell which
//     engine/version produced a given suggestion.
// ---------------------------------------------------------------------------

const ENGINE_VERSION = '2.1.0';

const ENGINE_CONFIG = {
  // Weights used when shortlisting candidates within a single role (Top, Bottom, ...)
  shortlistWeights: { mood: 0.35, color: 0.45, formality: 0.20 },
  // Weights used to roll individual pick quality into the outfit-level scorecard
  scoreWeights: { harmony: 0.40, mood: 0.35, weather: 0.25 },
  // Overall-score cutoffs for the confidence label
  confidence: { high: 85, medium: 65 },
  // How many top candidates per role enter the weighted-random shortlist
  shortlistSize: 3,
  // Bias exponent for weighted-random pick (higher = more greedy toward best score)
  pickBiasExponent: 3
};

// ---------- color math ----------

function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s, l };
}

function circularHueDiff(h1, h2) {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

// How well two colors work together, 0 (clash) to 1 (great match).
function pairHarmony(hslA, hslB) {
  if (hslA.s < 0.15 || hslB.s < 0.15) return 0.85; // neutral
  const diff = circularHueDiff(hslA.h, hslB.h);
  if (diff <= 20) return 1.0;       // analogous
  if (diff >= 150) return 0.9;      // complementary
  if (diff >= 100) return 0.55;     // triadic-ish
  return 0.3;                       // near-clash
}

function groupHarmony(hslList) {
  if (hslList.length < 2) return 1;
  let total = 0, n = 0;
  for (let i = 0; i < hslList.length; i++) {
    for (let j = i + 1; j < hslList.length; j++) {
      total += pairHarmony(hslList[i], hslList[j]);
      n++;
    }
  }
  return n ? total / n : 1;
}

function hueRelationLabel(hslA, hslB) {
  if (hslA.s < 0.15 || hslB.s < 0.15) return 'a grounding neutral pairing';
  const diff = circularHueDiff(hslA.h, hslB.h);
  if (diff <= 20) return 'a close, tonal echo';
  if (diff >= 150) return 'a bold complementary contrast';
  if (diff >= 100) return 'an energetic triadic contrast';
  return 'a slightly tense, near-clashing contrast';
}

const HUE_FAMILIES = [
  { max: 15, name: 'red' }, { max: 45, name: 'terracotta' }, { max: 70, name: 'amber' },
  { max: 95, name: 'olive' }, { max: 150, name: 'green' }, { max: 195, name: 'teal' },
  { max: 250, name: 'blue' }, { max: 290, name: 'indigo' }, { max: 330, name: 'magenta' },
  { max: 361, name: 'rose' }
];

function hueFamilyName(hsl) {
  if (hsl.s < 0.15) return hsl.l > 0.75 ? 'off-white' : hsl.l < 0.25 ? 'charcoal' : 'neutral grey';
  const found = HUE_FAMILIES.find((f) => hsl.h <= f.max);
  return (found || HUE_FAMILIES[HUE_FAMILIES.length - 1]).name;
}

function describeDepth(hsl) {
  if (hsl.l < 0.28) return 'deep';
  if (hsl.l > 0.72) return 'pale';
  return 'mid-toned';
}

// ---------- mood registry ----------
const MOOD_PROFILES = {
  Confident: { satMin: 0.5, lRange: [0.25, 0.55] },
  Relaxed: { satMax: 0.45, lRange: [0.35, 0.75] },
  Energetic: { satMin: 0.6, lRange: [0.4, 0.75] },
  Cozy: { warmHue: true, lRange: [0.2, 0.55] },
  Professional: { satMax: 0.35, lRange: [0.15, 0.45] },
  Romantic: { pinkHue: true, lRange: [0.35, 0.75] },
  Adventurous: { satMin: 0.55, lRange: [0.3, 0.7] },
  'Low-key': { satMax: 0.35, lRange: [0.3, 0.65] }
};

function registerMoodProfile(name, target) {
  MOOD_PROFILES[name] = Object.assign({}, MOOD_PROFILES[name] || {}, target);
}

function moodFitScore(hsl, mood) {
  const t = MOOD_PROFILES[mood];
  if (!t) return 0.5;
  let score = 0.5;
  if (t.satMin !== undefined) score += hsl.s >= t.satMin ? 0.25 : -0.15;
  if (t.satMax !== undefined) score += hsl.s <= t.satMax ? 0.25 : -0.15;
  if (t.lRange) score += (hsl.l >= t.lRange[0] && hsl.l <= t.lRange[1]) ? 0.15 : -0.05;
  if (t.warmHue) score += (hsl.h <= 60 || hsl.h >= 300) ? 0.15 : -0.05;
  if (t.pinkHue) score += (hsl.h >= 300 || hsl.h <= 20) ? 0.15 : -0.05;
  return Math.max(0, Math.min(1, score));
}

// ---------- weather registry ----------
const WEATHER_RULES = {
  cold: ['Cold', 'Snowy', 'Windy'],
  hot: ['Hot', 'Sunny', 'Humid']
};

function registerWeatherCondition(bucket, weatherName) {
  if (!WEATHER_RULES[bucket]) WEATHER_RULES[bucket] = [];
  if (!WEATHER_RULES[bucket].includes(weatherName)) WEATHER_RULES[bucket].push(weatherName);
}

function isColdWeather(weather) { return (WEATHER_RULES.cold || []).includes(weather); }
function isHotWeather(weather) { return (WEATHER_RULES.hot || []).includes(weather); }

const BUSY_PATTERNS = ['Striped', 'Plaid', 'Floral'];
const MAIN_ROLES = ['Top', 'Bottom', 'Dress', 'Ethnic Wear', 'Outerwear'];

// ---------- category → role registry ----------
const CATEGORY_ROLES = {
  'Casual Shirt': 'Top',
  'Formal Shirt': 'Top',
  'T-Shirt / Polo': 'Top',
  'Kurta': 'Top',
  'Formal Trousers': 'Bottom',
  'Chinos': 'Bottom',
  'Jeans': 'Bottom',
  'Shorts': 'Bottom',
  'Pyjamas / Trackpants': 'Bottom',
  'Dress / One-Piece': 'Dress',
  'Saree / Ethnic Set': 'Ethnic Wear',
  'Jacket / Blazer / Coat': 'Outerwear',
  'Nehru Jacket / Dupatta': 'Outerwear',
  'Formal Shoes / Loafers': 'Footwear',
  'Sneakers / Casual Shoes': 'Footwear',
  'Juttis / Kolhapuris / Sandals': 'Footwear',
  'Watch / Belt / Sunglasses': 'Accessory',
  'Jewelry / Bags': 'Accessory',

  // Legacy mappings
  'Top': 'Top',
  'Bottom': 'Bottom',
  'Dress': 'Dress',
  'Outerwear': 'Outerwear',
  'Shoes': 'Footwear',
  'Footwear': 'Footwear',
  'Accessory': 'Accessory',
  'Ethnic Wear': 'Ethnic Wear'
};

function registerCategoryRole(categoryName, role) {
  CATEGORY_ROLES[categoryName] = role;
}

function getSopRole(item) {
  const cat = item.category || item.cat || 'Top';
  return CATEGORY_ROLES[cat] || 'Top';
}

function getItemFormality(item) {
  const cat = item.category || item.cat || '';
  const nameDesc = (item.name + ' ' + (item.description || '')).toLowerCase();
  if (cat.includes('Formal') || nameDesc.includes('formal') || nameDesc.includes('blazer') || nameDesc.includes('suit') || nameDesc.includes('oxford')) return 'formal';
  if (cat.includes('Ethnic') || cat.includes('Kurta') || cat.includes('Saree') || cat.includes('Juttis') || nameDesc.includes('kurta') || nameDesc.includes('sherwani')) return 'ethnic';
  if (cat.includes('Shorts') || cat.includes('T-Shirt') || cat.includes('Sneakers') || nameDesc.includes('tee') || nameDesc.includes('casual')) return 'casual';
  return 'smart-casual';
}

function getContextFormality(ctx) {
  const occasion = (ctx.occasion || '').toLowerCase();
  const mood = (ctx.mood || '').toLowerCase();
  if (occasion.includes('meeting') || occasion.includes('work') || occasion.includes('formal') || occasion.includes('office') || mood === 'professional') return 'formal';
  if (occasion.includes('wedding') || occasion.includes('festive') || occasion.includes('party') || occasion.includes('ethnic') || mood === 'romantic' || mood === 'confident') return 'ethnic';
  if (occasion.includes('weekend') || occasion.includes('casual') || mood === 'relaxed' || mood === 'low-key' || mood === 'cozy') return 'casual';
  return 'smart-casual';
}

function isBusyPattern(pattern) {
  return BUSY_PATTERNS.includes(pattern);
}

// Shortlist by role and scoring
function shortlistOfRole(items, role, mood, baseHslList, currentPicks = [], targetFormality = 'smart-casual', topN = ENGINE_CONFIG.shortlistSize) {
  let pool = items.filter((i) => getSopRole(i) === role);
  if (pool.length === 0) return [];

  // Pattern rule: max 1 busy pattern among main garments
  if (MAIN_ROLES.includes(role)) {
    const hasBusyMain = currentPicks.some(
      (p) => MAIN_ROLES.includes(getSopRole(p)) && isBusyPattern(p.pattern)
    );
    if (hasBusyMain) {
      const nonBusy = pool.filter((i) => !isBusyPattern(i.pattern));
      if (nonBusy.length > 0) pool = nonBusy;
    }
  }

  const w = ENGINE_CONFIG.shortlistWeights;
  const scored = pool.map((item) => {
    const hsl = hexToHsl(item.hex || '#888888');
    const mScore = moodFitScore(hsl, mood);
    const cScore = baseHslList.length ? groupHarmony([...baseHslList, hsl]) : 1;
    const fType = getItemFormality(item);
    const fScore = fType === targetFormality ? 1.0 : (fType === 'smart-casual' ? 0.8 : 0.6);
    return { item, score: mScore * w.mood + cScore * w.color + fScore * w.formality, mScore, cScore, fScore };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.min(topN, scored.length));
}

function weightedPick(shortlist, excludeIds = []) {
  if (shortlist.length === 0) return null;
  let pool = shortlist.filter((c) => !excludeIds.includes(String(c.item.id)));
  if (pool.length === 0) pool = shortlist;

  const weights = pool.map((c) => Math.pow(Math.max(c.score, 0.01), ENGINE_CONFIG.pickBiasExponent));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i].item;
  }
  return pool[pool.length - 1].item;
}

function bestOfRole(items, role, mood, baseHslList, excludeIds = [], currentPicks = [], targetFormality = 'smart-casual') {
  const shortlist = shortlistOfRole(items, role, mood, baseHslList, currentPicks, targetFormality);
  return weightedPick(shortlist, excludeIds);
}

function pickVariant(bank, seedKey) {
  let hash = 0;
  const s = String(seedKey);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return bank[hash % bank.length];
}

function findCompanion(item, hsl, otherPicks, hslLookup) {
  if (!otherPicks.length) return null;
  let best = null;
  otherPicks.forEach((p) => {
    const pHsl = hslLookup(p);
    const score = pairHarmony(hsl, pHsl);
    if (!best || score > best.score) best = { item: p, score, hsl: pHsl };
  });
  return best;
}

function generateItemJustification(item, ctx, role, otherPicks, hslLookup) {
  const mood = ctx.mood || 'general';
  const weather = ctx.weather || 'mild';
  const formality = getItemFormality(item);
  const targetFormality = getContextFormality(ctx);
  const hsl = hslLookup(item);
  const family = hueFamilyName(hsl);
  const depth = describeDepth(hsl);
  const mScore = Math.round(moodFitScore(hsl, mood) * 100);
  const companion = findCompanion(item, hsl, otherPicks, hslLookup);

  const companionClause = companion
    ? `, striking ${hueRelationLabel(hsl, companion.hsl)} with the ${companion.item.name}`
    : '';

  const formalityClause = formality === targetFormality
    ? `sitting squarely in the ${targetFormality} register the moment calls for`
    : (formality === 'smart-casual'
      ? `flexing easily toward a ${targetFormality} feel`
      : `nudging the outfit's formality toward ${formality}`);

  const OPENERS = {
    Top: ['Anchoring the upper half,', 'As the visual focal point up top,', 'Setting the tone from the shoulders down,'],
    Bottom: ['Grounding the silhouette,', 'Carrying the base of the look,', 'Balancing the top half,'],
    Dress: ['As a self-contained statement,', 'Doing double duty as the whole base,', 'Built to stand alone,'],
    'Ethnic Wear': ['Rooted in tradition,', 'Carrying the cultural core of the look,', 'Bringing craft and heritage to the fore,'],
    Outerwear: ['Layered on top,', 'Wrapping the silhouette,', 'Adding a finishing layer,'],
    Footwear: ['Closing out the look at ground level,', 'Grounding the whole outfit,', 'Finishing the silhouette,'],
    Accessory: ['As a final accent,', 'Punctuating the outfit,', 'Adding a last detail,']
  };
  const opener = pickVariant(OPENERS[role] || ['Rounding out the look,'], item.id);

  let sentence = `${opener} the ${family}, ${depth} "${item.name}" scores ${mScore}% on the ${mood.toLowerCase()} mood target${companionClause}, and is ${formalityClause}.`;

  if (role === 'Outerwear') {
    sentence += isColdWeather(weather)
      ? ` It's doing real work today — ${weather.toLowerCase()} conditions call for the extra layer.`
      : ` It's here mainly for the palette, not the temperature.`;
  } else if (role === 'Footwear') {
    sentence += ` Comfortable enough to carry the ${(ctx.occasion || 'day').toLowerCase()} from start to finish.`;
  } else if (role === 'Ethnic Wear' || role === 'Dress') {
    sentence += ` for ${ctx.occasion || 'the occasion'}.`;
  }

  return sentence;
}

function findHarmonyExtremes(picks, hslLookup) {
  if (picks.length < 2) return null;
  let best = null, worst = null;
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      const score = pairHarmony(hslLookup(picks[i]), hslLookup(picks[j]));
      const pair = { a: picks[i], b: picks[j], score };
      if (!best || score > best.score) best = pair;
      if (!worst || score < worst.score) worst = pair;
    }
  }
  return { best, worst };
}

function buildColorStory(picks, hslList, rawHarmony) {
  const hslLookup = (p) => hslList[picks.indexOf(p)];
  const extremes = findHarmonyExtremes(picks, hslLookup);
  const pct = Math.round(rawHarmony * 100);

  if (!extremes) {
    const only = picks[0];
    return only
      ? `A single-piece base built around ${hueFamilyName(hexToHsl(only.hex || '#888'))} tones — nothing else to harmonize against yet.`
      : 'No pieces selected yet.';
  }

  const bestLine = `${extremes.best.a.name} and ${extremes.best.b.name} do the most work together (${hueRelationLabel(hexToHsl(extremes.best.a.hex || '#888'), hexToHsl(extremes.best.b.hex || '#888'))}).`;

  if (rawHarmony >= 0.85) {
    return `A tightly unified palette at ${pct}% harmony — ${bestLine}`;
  }
  if (rawHarmony >= 0.7) {
    return `A cohesive, easy-to-wear palette at ${pct}% harmony. ${bestLine}`;
  }
  if (rawHarmony >= 0.5) {
    return `A balanced palette with some intentional contrast (${pct}% harmony). ${bestLine} The ${extremes.worst.a.name} and ${extremes.worst.b.name} pull in the most different directions, which keeps things from feeling flat.`;
  }
  return `A deliberately eclectic mix at ${pct}% harmony — ${extremes.worst.a.name} and ${extremes.worst.b.name} are the biggest contrast in the set, so this look leans bold rather than blended.`;
}

function buildWeatherFit(picks, weather, weatherScore) {
  const hasOuter = picks.some((p) => getSopRole(p) === 'Outerwear');
  const outerItem = picks.find((p) => getSopRole(p) === 'Outerwear');
  if (isColdWeather(weather)) {
    return hasOuter
      ? `${outerItem.name} was pulled in specifically to cover ${weather.toLowerCase()} conditions — that layer is doing ${weatherScore}% of the weather-suitability work here.`
      : `No outerwear made the cut despite ${weather.toLowerCase()} conditions, which is why the weather-fit score sits at only ${weatherScore}% — worth adding a layer if you have one in the closet.`;
  }
  if (isHotWeather(weather)) {
    return `Kept deliberately unlayered for ${weather.toLowerCase()} conditions (${weatherScore}% weather fit) — nothing here will trap heat.`;
  }
  return `A moderate, unfussy fit for ${weather.toLowerCase()} conditions (${weatherScore}% weather fit) — no extremes to plan around.`;
}

function buildMoodFit(picks, hslList, mood, avgMood) {
  const pct = Math.round(avgMood * 100);
  let strongest = null;
  picks.forEach((p, i) => {
    const s = moodFitScore(hslList[i], mood);
    if (!strongest || s > strongest.score) strongest = { item: p, score: s };
  });
  const leadClause = strongest ? ` — ${strongest.item.name} carries it hardest at ${Math.round(strongest.score * 100)}%.` : '.';
  if (avgMood >= 0.75) return `Strongly reads as ${mood.toLowerCase()} (${pct}% average fit)${leadClause}`;
  if (avgMood >= 0.55) return `A solid match for a ${mood.toLowerCase()} mood (${pct}% average fit)${leadClause}`;
  return `A loose interpretation of ${mood.toLowerCase()} given what's in the closet right now (${pct}% average fit)${leadClause} Adding more pieces in this mood's palette would sharpen future picks.`;
}

function buildRuleBasedOutfit(wardrobe, ctx, recentPickIds = []) {
  const { weather, mood } = ctx;
  const targetFormality = getContextFormality(ctx);
  const picks = [];
  const hslList = [];
  const exclude = (recentPickIds || []).map(String);

  const ethnicOption = bestOfRole(wardrobe, 'Ethnic Wear', mood, [], exclude, picks, targetFormality);
  const dressOption = bestOfRole(wardrobe, 'Dress', mood, [], exclude, picks, targetFormality);
  const topOption = bestOfRole(wardrobe, 'Top', mood, [], exclude, picks, targetFormality);
  const bottomOption = topOption
    ? bestOfRole(wardrobe, 'Bottom', mood, [hexToHsl(topOption.hex || '#888')], exclude, topOption ? [topOption] : [], targetFormality)
    : bestOfRole(wardrobe, 'Bottom', mood, [], exclude, [], targetFormality);

  let base = [];
  if (targetFormality === 'ethnic' && ethnicOption) {
    base = [ethnicOption];
  } else if (dressOption && (!topOption || !bottomOption)) {
    base = [dressOption];
  } else if (topOption && bottomOption) {
    base = [topOption, bottomOption];
  } else if (ethnicOption) {
    base = [ethnicOption];
  } else if (dressOption) {
    base = [dressOption];
  } else if (topOption) {
    base = [topOption];
  } else if (bottomOption) {
    base = [bottomOption];
  }

  base.forEach((item) => { picks.push(item); hslList.push(hexToHsl(item.hex || '#888')); });

  // Outerwear
  const needsOuterwear = isColdWeather(weather);
  const avoidOuterwear = isHotWeather(weather);
  if (!avoidOuterwear) {
    const outer = bestOfRole(wardrobe, 'Outerwear', mood, hslList, exclude, picks, targetFormality);
    if (outer && (needsOuterwear || groupHarmony([...hslList, hexToHsl(outer.hex || '#888')]) > 0.75)) {
      picks.push(outer);
      hslList.push(hexToHsl(outer.hex || '#888'));
    }
  }

  // Footwear
  const footwear = bestOfRole(wardrobe, 'Footwear', mood, hslList, exclude, picks, targetFormality);
  if (footwear) { picks.push(footwear); hslList.push(hexToHsl(footwear.hex || '#888')); }

  // Accessory
  const beforeHarmony = groupHarmony(hslList);
  const accessory = bestOfRole(wardrobe, 'Accessory', mood, hslList, exclude, picks, targetFormality);
  if (accessory) {
    const afterHarmony = groupHarmony([...hslList, hexToHsl(accessory.hex || '#888')]);
    if (afterHarmony >= beforeHarmony - 0.05) {
      picks.push(accessory);
      hslList.push(hexToHsl(accessory.hex || '#888'));
    }
  }

  const rawHarmony = groupHarmony(hslList);
  const avgMood = hslList.reduce((sum, h) => sum + moodFitScore(h, mood), 0) / (hslList.length || 1);
  const weatherMatch = needsOuterwear
    ? (picks.some(p => getSopRole(p) === 'Outerwear') ? 0.95 : 0.6)
    : (avoidOuterwear ? 0.9 : 0.85);

  const sw = ENGINE_CONFIG.scoreWeights;
  const harmonyScore = Math.round(rawHarmony * 100);
  const moodScore = Math.round(avgMood * 100);
  const weatherScore = Math.round(weatherMatch * 100);
  const overallScore = Math.round(harmonyScore * sw.harmony + moodScore * sw.mood + weatherScore * sw.weather);

  const confidence = overallScore >= ENGINE_CONFIG.confidence.high
    ? 'high'
    : (overallScore >= ENGINE_CONFIG.confidence.medium ? 'medium' : 'low');

  const hslLookup = (p) => hslList[picks.indexOf(p)];
  const itemJustifications = {};
  picks.forEach((item) => {
    const role = getSopRole(item);
    const others = picks.filter((p) => p !== item);
    itemJustifications[String(item.id)] = generateItemJustification(item, ctx, role, others, hslLookup);
  });

  const personaNames = {
    formal: 'Sharp Professional Elegance',
    ethnic: 'Festive Ethnic Sophistication',
    casual: 'Relaxed & Breathable Casual',
    'smart-casual': 'Smart-Casual Modern Ensemble'
  };
  const persona = personaNames[targetFormality] || 'Custom Styled Ensemble';

  return {
    engine_version: ENGINE_VERSION,
    engine_source: 'rules',
    pick_ids: picks.map((p) => String(p.id)),
    persona,
    harmony_score: harmonyScore,
    mood_score: moodScore,
    weather_score: weatherScore,
    overall_score: overallScore,
    confidence,
    item_justifications: itemJustifications,
    color_story: buildColorStory(picks, hslList, rawHarmony),
    weather_fit: buildWeatherFit(picks, weather, weatherScore),
    mood_fit: buildMoodFit(picks, hslList, mood, avgMood)
  };
}

// ---------- AI-based outfit builder ----------

async function requestAiOutfit(wardrobe, ctx, apiKey) {
  const { weather, temp, mood, occasion } = ctx;
  const wardrobeForPrompt = wardrobe.map((i) => ({
    id: String(i.id), name: i.name, description: i.description || undefined,
    category: i.category || i.cat, pattern: i.pattern, size: i.size || undefined, hex: i.hex
  }));

  const prompt = `You are an expert stylist for Poshak (attire & outfit stylist).
Wardrobe: ${JSON.stringify(wardrobeForPrompt)}.
Context: Weather=${weather}${temp ? ', Temp=' + temp + '°C' : ''}, Mood=${mood}, Occasion=${occasion || 'any'}.

Only pick from the wardrobe IDs given — never invent an item.

Write reasoning that is SPECIFIC to this exact combination of pieces, not generic
boilerplate. Concretely:
- In each item_justifications entry, reference that item's actual hex color/tone and
  name at least one other picked item it visually relates to (echoes, contrasts, or
  grounds it), plus why it fits the weather/mood/occasion.
- In color_story, name the two pieces that harmonize best together and, if the palette
  isn't tightly unified, the two that contrast the most.
- In weather_fit and mood_fit, cite the actual numeric sub-score you're reporting and
  point to the specific piece most responsible for it.
- Vary sentence structure across items — don't reuse the same opening clause twice.

Return ONLY valid JSON matching this exact structure:
{
  "pick_ids": ["id1", "id2"],
  "persona": "Catchy persona title (e.g. Crisp Professional Layering)",
  "harmony_score": 90,
  "mood_score": 85,
  "weather_score": 95,
  "overall_score": 90,
  "confidence": "high|medium|low",
  "item_justifications": {
    "id1": "Detailed, specific explanation why id1 was chosen...",
    "id2": "Detailed, specific explanation why id2 was chosen..."
  },
  "color_story": "Specific explanation of color synergy, naming pieces...",
  "weather_fit": "Specific explanation of weather suitability, naming a piece...",
  "mood_fit": "Specific explanation of mood alignment, naming a piece..."
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    throw new Error('API error (' + res.status + ')');
  }

  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  parsed.engine_version = ENGINE_VERSION;
  parsed.engine_source = 'ai';
  return parsed;
}

// ---------- CLOSET REVIEW ENGINE ----------

function analyzeClosetReadiness(wardrobe) {
  if (!wardrobe || wardrobe.length === 0) {
    return {
      inventory_summary: 'Your closet is currently empty. Add your first pieces using the + button to unlock closet review insights.',
      scenarios: [],
      missing_recommendations: []
    };
  }

  const roleCounts = { Top: 0, Bottom: 0, Dress: 0, 'Ethnic Wear': 0, Outerwear: 0, Footwear: 0, Accessory: 0 };
  const formalityCounts = { formal: 0, casual: 0, ethnic: 0, 'smart-casual': 0 };
  const colorFamilies = new Set();

  wardrobe.forEach((item) => {
    const role = getSopRole(item);
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    const form = getItemFormality(item);
    formalityCounts[form] = (formalityCounts[form] || 0) + 1;
    if (item.hex) colorFamilies.add(hueFamilyName(hexToHsl(item.hex)));
  });

  const total = wardrobe.length;
  const activeRoles = Object.keys(roleCounts).filter(r => roleCounts[r] > 0);
  const colorList = Array.from(colorFamilies);

  const summaryText = `Your closet has ${total} registered piece${total === 1 ? '' : 's'} across ${activeRoles.length} core garment categories (${activeRoles.join(', ')}). Your wardrobe palette features ${colorFamilies.size} distinct color groups: ${colorList.join(', ')}.`;

  const scenarios = [
    {
      id: 'professional',
      name: 'Professional & Office Work',
      score: Math.min(100, Math.round(((formalityCounts.formal * 35) + (roleCounts.Top > 0 ? 25 : 0) + (roleCounts.Bottom > 0 ? 25 : 0) + (roleCounts.Footwear > 0 ? 15 : 0)))),
      description: (formalityCounts.formal > 0 && roleCounts.Footwear > 0)
        ? 'Well-structured with formal pieces suitable for corporate meetings and work settings.'
        : 'Needs formal shirts, trousers, or formal shoes to assemble polished office outfits.'
    },
    {
      id: 'casual',
      name: 'Casual & Weekend Outings',
      score: Math.min(100, Math.round(((formalityCounts.casual * 30) + (roleCounts.Top > 0 ? 30 : 0) + (roleCounts.Bottom > 0 ? 30 : 0) + (roleCounts.Footwear > 0 ? 10 : 0)))),
      description: (roleCounts.Top > 0 && roleCounts.Bottom > 0)
        ? 'Solid foundation for relaxed daily wear, casual coffee runs, and weekend events.'
        : 'Add easy t-shirts, casual shirts, or chinos/shorts for effortless casual styling.'
    },
    {
      id: 'ethnic',
      name: 'Festive & Ethnic Celebrations',
      score: Math.min(100, Math.round(((roleCounts['Ethnic Wear'] * 60) + (formalityCounts.ethnic * 40)))),
      description: roleCounts['Ethnic Wear'] > 0
        ? 'Equipped with traditional garments ready for festive celebrations and cultural gatherings.'
        : 'No ethnic kurtas, sarees, or juttis found — consider adding ethnic wear.'
    },
    {
      id: 'summer',
      name: 'Hot Weather & Summer Comfort',
      score: Math.min(100, Math.round(((roleCounts.Top > 0 ? 40 : 0) + (roleCounts.Bottom > 0 ? 40 : 0) + (roleCounts.Outerwear === 0 ? 20 : 10)))),
      description: 'Contains light, unlayered pieces ideal for sunny and warm days.'
    },
    {
      id: 'winter',
      name: 'Cold Weather & Winter Layering',
      score: Math.min(100, Math.round(((roleCounts.Outerwear * 60) + (roleCounts.Top > 0 ? 20 : 0) + (roleCounts.Bottom > 0 ? 20 : 0)))),
      description: roleCounts.Outerwear > 0
        ? 'Layering jackets/blazers are available to handle chilly temperatures.'
        : 'Lacks outerwear jackets or blazers for cold condition protection.'
    }
  ];

  const missingRecs = [];

  if (roleCounts.Footwear === 0) {
    missingRecs.push({
      item_type: 'Footwear (Formal Shoes / Sneakers)',
      reason: 'No shoes registered yet. Footwear anchors every outfit and completes the silhouette.',
      suggested_items: ['Formal Leather Loafers', 'Clean White Sneakers'],
      matching_colors: [
        { name: 'Chestnut Brown', hex: '#5C4033', reason: 'Matches neutral, navy, and khaki bottoms' },
        { name: 'Classic White', hex: '#F5F5F5', reason: 'Universal match for all casual wear' }
      ]
    });
  }

  if (roleCounts.Bottom === 0) {
    missingRecs.push({
      item_type: 'Bottoms (Trousers / Chinos / Jeans)',
      reason: 'No pants found. Tops require matching trousers or jeans for complete looks.',
      suggested_items: ['Beige / Khaki Chinos', 'Navy Tailored Trousers'],
      matching_colors: [
        { name: 'Beige / Khaki', hex: '#C2B280', reason: 'Pairs with navy, white, and dark tops' },
        { name: 'Navy Blue', hex: '#1B2A4A', reason: 'Anchor color for formal and smart-casual wear' }
      ]
    });
  }

  if (roleCounts.Outerwear === 0) {
    missingRecs.push({
      item_type: 'Outerwear (Blazer / Jacket / Nehru Jacket)',
      reason: 'An outerwear layer elevates smart-casual looks and provides cold weather protection.',
      suggested_items: ['Navy Tailored Blazer', 'Olive Green Jacket'],
      matching_colors: [
        { name: 'Charcoal Grey', hex: '#36454F', reason: 'Versatile outer layer that pairs with light tops' },
        { name: 'Olive Green', hex: '#4B5320', reason: 'Earthy depth for casual layering' }
      ]
    });
  }

  if (roleCounts['Ethnic Wear'] === 0) {
    missingRecs.push({
      item_type: 'Ethnic Wear (Kurta / Nehru Jacket / Saree)',
      reason: 'Having traditional attire prepares your closet for festive occasions and family events.',
      suggested_items: ['Cream Silk Kurta', 'Maroon Nehru Jacket'],
      matching_colors: [
        { name: 'Off-White / Cream', hex: '#F5F2EB', reason: 'Classic traditional base color' },
        { name: 'Royal Maroon', hex: '#800020', reason: 'Rich festive accent tone' }
      ]
    });
  }

  return {
    engine_version: ENGINE_VERSION,
    engine_source: 'rules',
    inventory_summary: summaryText,
    scenarios,
    missing_recommendations: missingRecs
  };
}

async function requestAiClosetReview(wardrobe, apiKey) {
  const wardrobeForPrompt = wardrobe.map((i) => ({
    id: String(i.id), name: i.name, description: i.description || undefined,
    category: i.category || i.cat, pattern: i.pattern, size: i.size || undefined, hex: i.hex
  }));

  const prompt = `You are an expert wardrobe analyst for Poshak (attire & outfit stylist).
Wardrobe Inventory: ${JSON.stringify(wardrobeForPrompt)}.

Provide a deep critique and review of this wardrobe.
Return ONLY valid JSON matching this exact structure:
{
  "inventory_summary": "Detailed overall assessment of wardrobe strengths, color diversity, and versatility...",
  "scenarios": [
    { "id": "professional", "name": "Professional & Office Work", "score": 80, "description": "Analysis of work readiness..." },
    { "id": "casual", "name": "Casual & Weekend Outings", "score": 90, "description": "Analysis of casual readiness..." },
    { "id": "ethnic", "name": "Festive & Ethnic Celebrations", "score": 40, "description": "Analysis of ethnic readiness..." },
    { "id": "summer", "name": "Hot Weather & Summer Comfort", "score": 85, "description": "Analysis of summer readiness..." },
    { "id": "winter", "name": "Cold Weather & Winter Layering", "score": 50, "description": "Analysis of winter readiness..." }
  ],
  "missing_recommendations": [
    {
      "item_type": "Name of missing item type (e.g. Footwear / Outerwear)",
      "reason": "Why this piece is essential for wardrobe balance...",
      "suggested_items": ["Suggested Specific Piece 1", "Suggested Specific Piece 2"],
      "matching_colors": [
        { "name": "Color Name", "hex": "#HEXCODE", "reason": "Why this color harmonizes with current items..." }
      ]
    }
  ]
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    throw new Error('API error (' + res.status + ')');
  }

  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  parsed.engine_version = ENGINE_VERSION;
  parsed.engine_source = 'ai';
  return parsed;
}

async function requestAiItemFields(photoDataUrl, apiKey) {
  if (!apiKey) throw new Error('API key required for AI item parsing');
  let mediaType = 'image/jpeg';
  let base64 = photoDataUrl;
  if (photoDataUrl.includes(',')) {
    const parts = photoDataUrl.split(',');
    const meta = parts[0];
    base64 = parts[1];
    const match = meta.match(/data:(.*);base64/);
    if (match) mediaType = match[1];
  }

  const categoryList = [
    'Casual Shirt', 'Formal Shirt', 'T-Shirt / Polo', 'Kurta',
    'Formal Trousers', 'Chinos', 'Jeans', 'Shorts', 'Pyjamas / Trackpants',
    'Dress / One-Piece', 'Saree / Ethnic Set', 'Jacket / Blazer / Coat',
    'Nehru Jacket / Dupatta', 'Formal Shoes / Loafers', 'Sneakers / Casual Shoes',
    'Juttis / Kolhapuris / Sandals', 'Watch / Belt / Sunglasses', 'Jewelry / Bags'
  ];

  const prompt = `You are cataloguing a single clothing item photo for a wardrobe app.
Look only at the garment in the photo. Choose category from EXACTLY this list (verbatim match required):
${JSON.stringify(categoryList)}

Return ONLY valid JSON with these exact keys:
{
  "name": "Short, specific name (e.g. 'Navy Cotton Chinos'), max 6 words",
  "description": "1 sentence describing fit, texture, or key details",
  "category": "must be one exact verbatim string from the provided category list",
  "pattern": "Solid | Striped | Plaid | Floral | Textured",
  "size_guess": "size string ONLY if a tag/label is clearly visible, else empty string",
  "confidence": "high | medium | low"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });

  if (!res.ok) {
    throw new Error('API error (' + res.status + ')');
  }

  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function analyzePersonalProfileAi(photoDataUrl, apiKey) {
  if (!apiKey) throw new Error('API key required for AI personal profile analysis');
  let mediaType = 'image/jpeg';
  let base64 = photoDataUrl;
  if (photoDataUrl.includes(',')) {
    const parts = photoDataUrl.split(',');
    const meta = parts[0];
    base64 = parts[1];
    const match = meta.match(/data:(.*);base64/);
    if (match) mediaType = match[1];
  }

  const prompt = `You are a professional image consultant & personal stylist.
Analyze the person in this photo for fashion styling.
Return ONLY valid JSON:
{
  "skin_tone": "Fair | Wheatish | Tan | Deep",
  "undertone": "Warm Golden | Cool Pink | Neutral Olive",
  "color_season": "Warm Autumn | Cool Winter | Warm Spring | Cool Summer",
  "best_hex_colors": ["#HEX1", "#HEX2", "#HEX3", "#HEX4"],
  "avoid_hex_colors": ["#HEX1", "#HEX2"],
  "body_shape": "Inverted Triangle | Rectangle / Athletic | Hourglass | Pear / Triangle | Oval / Rounded",
  "proportions": "Short description of proportions",
  "styling_advice": "1-2 sentence tailoring advice for this body shape and skin tone"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });

  if (!res.ok) throw new Error('API error (' + res.status + ')');
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// Namespaced handle
const PoshakOutfitEngine = {
  version: ENGINE_VERSION,
  config: ENGINE_CONFIG,
  registerMoodProfile,
  registerWeatherCondition,
  registerCategoryRole,
  buildRuleBasedOutfit,
  requestAiOutfit,
  analyzeClosetReadiness,
  requestAiClosetReview,
  requestAiItemFields,
  analyzePersonalProfileAi
};
if (typeof window !== 'undefined') {
  window.PoshakOutfitEngine = PoshakOutfitEngine;
}