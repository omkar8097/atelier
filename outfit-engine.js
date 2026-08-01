// Two ways to get an outfit:
//   1. buildRuleBasedOutfit()  — deterministic, local, no network, "the app's own preferences"
//   2. requestAiOutfit()       — calls Claude with the user's own API key

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
  if (hslA.s < 0.15 || hslB.s < 0.15) return 0.85; // a neutral pairs with almost anything
  const diff = circularHueDiff(hslA.h, hslB.h);
  if (diff <= 20) return 1.0;       // analogous
  if (diff >= 150) return 0.9;      // complementary
  if (diff >= 100) return 0.55;     // triadic-ish, can work but less crisp
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

// ---------- mood scoring ----------

const MOOD_TARGETS = {
  Confident:    { satMin: 0.5, lRange: [0.25, 0.55] },
  Relaxed:      { satMax: 0.45, lRange: [0.35, 0.75] },
  Energetic:    { satMin: 0.6, lRange: [0.4, 0.75] },
  Cozy:         { warmHue: true, lRange: [0.2, 0.55] },
  Professional: { satMax: 0.35, lRange: [0.15, 0.45] },
  Romantic:     { pinkHue: true, lRange: [0.35, 0.75] },
  Adventurous:  { satMin: 0.55, lRange: [0.3, 0.7] },
  'Low-key':    { satMax: 0.35, lRange: [0.3, 0.65] }
};

function moodFitScore(hsl, mood) {
  const t = MOOD_TARGETS[mood];
  if (!t) return 0.5;
  let score = 0.5;
  if (t.satMin !== undefined) score += hsl.s >= t.satMin ? 0.25 : -0.15;
  if (t.satMax !== undefined) score += hsl.s <= t.satMax ? 0.25 : -0.15;
  if (t.lRange) score += (hsl.l >= t.lRange[0] && hsl.l <= t.lRange[1]) ? 0.15 : -0.05;
  if (t.warmHue) score += (hsl.h <= 60 || hsl.h >= 300) ? 0.15 : -0.05;
  if (t.pinkHue) score += (hsl.h >= 300 || hsl.h <= 20) ? 0.15 : -0.05;
  return Math.max(0, Math.min(1, score));
}

// ---------- weather rules ----------

const COLD_WEATHER = ['Cold', 'Snowy', 'Windy'];
const HOT_WEATHER = ['Hot', 'Sunny', 'Humid'];

// ---------- rule-based outfit builder ----------

const BUSY_PATTERNS = ['Striped', 'Plaid', 'Floral'];
const MAIN_GARMENTS = ['Top', 'Bottom', 'Dress', 'Outerwear'];

function isBusyPattern(pattern) {
  return BUSY_PATTERNS.includes(pattern);
}

// Returns the top N scored candidates for a category, considering color, mood, and pattern SOP limits.
function shortlistOfCategory(items, category, mood, baseHslList, currentPicks = [], topN = 3) {
  let pool = items.filter((i) => (i.category || i.cat) === category);
  if (pool.length === 0) return [];

  // SOP Step 6 Pattern Rule: Max ONE busy pattern among main garments (Top, Bottom, Dress, Outerwear)
  if (MAIN_GARMENTS.includes(category)) {
    const hasBusyMain = currentPicks.some(
      (p) => MAIN_GARMENTS.includes(p.category || p.cat) && isBusyPattern(p.pattern)
    );
    if (hasBusyMain) {
      const nonBusyPool = pool.filter((i) => !isBusyPattern(i.pattern));
      if (nonBusyPool.length > 0) {
        pool = nonBusyPool;
      }
    }
  }

  const scored = pool.map((item) => {
    const hsl = hexToHsl(item.hex || '#888888');
    const mScore = moodFitScore(hsl, mood);
    const cScore = baseHslList.length ? groupHarmony([...baseHslList, hsl]) : 1;
    return { item, score: mScore * 0.4 + cScore * 0.6 };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.min(topN, scored.length));
}

// Weighted-random pick from a shortlist, biased toward higher scores (score^3) and avoiding recent pick IDs.
function weightedPick(shortlist, excludeIds = []) {
  if (shortlist.length === 0) return null;
  let pool = shortlist.filter((c) => !excludeIds.includes(String(c.item.id)));
  if (pool.length === 0) pool = shortlist; // fallback if exclusion leaves pool empty

  const weights = pool.map((c) => Math.pow(Math.max(c.score, 0.01), 3));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i].item;
  }
  return pool[pool.length - 1].item;
}

function bestOfCategory(items, category, mood, baseHslList, excludeIds = [], currentPicks = []) {
  const shortlist = shortlistOfCategory(items, category, mood, baseHslList, currentPicks);
  return weightedPick(shortlist, excludeIds);
}

function buildRuleBasedOutfit(wardrobe, ctx, recentPickIds = []) {
  const { weather, mood } = ctx;
  const picks = [];
  const hslList = [];
  const exclude = (recentPickIds || []).map(String);

  const dressOption = bestOfCategory(wardrobe, 'Dress', mood, [], exclude, picks);
  const topOption = bestOfCategory(wardrobe, 'Top', mood, [], exclude, picks);
  const bottomOption = topOption
    ? bestOfCategory(wardrobe, 'Bottom', mood, [hexToHsl(topOption.hex || '#888')], exclude, topOption ? [topOption] : [])
    : bestOfCategory(wardrobe, 'Bottom', mood, [], exclude, []);

  let base = [];
  if (dressOption && (!topOption || !bottomOption)) {
    base = [dressOption];
  } else if (dressOption && topOption && bottomOption) {
    const dressScore = moodFitScore(hexToHsl(dressOption.hex || '#888'), mood);
    const comboHsl = [hexToHsl(topOption.hex || '#888'), hexToHsl(bottomOption.hex || '#888')];
    const comboScore = (moodFitScore(comboHsl[0], mood) + moodFitScore(comboHsl[1], mood)) / 2 * 0.5
      + groupHarmony(comboHsl) * 0.5;

    // Probabilistic selection if scores are within ~15%
    const closeCall = Math.abs(dressScore - comboScore) < 0.15 * Math.max(dressScore, comboScore);
    if (closeCall) {
      const dressWeight = Math.pow(Math.max(dressScore, 0.01), 3);
      const comboWeight = Math.pow(Math.max(comboScore, 0.01), 3);
      base = Math.random() * (dressWeight + comboWeight) < dressWeight
        ? [dressOption]
        : [topOption, bottomOption];
    } else {
      base = dressScore >= comboScore ? [dressOption] : [topOption, bottomOption];
    }
  } else if (topOption && bottomOption) {
    base = [topOption, bottomOption];
  } else if (dressOption) {
    base = [dressOption];
  } else if (topOption) {
    base = [topOption];
  } else if (bottomOption) {
    base = [bottomOption];
  }

  base.forEach((item) => { picks.push(item); hslList.push(hexToHsl(item.hex || '#888')); });

  // outerwear
  const needsOuterwear = COLD_WEATHER.includes(weather);
  const avoidOuterwear = HOT_WEATHER.includes(weather);
  if (!avoidOuterwear) {
    const outer = bestOfCategory(wardrobe, 'Outerwear', mood, hslList, exclude, picks);
    if (outer && (needsOuterwear || groupHarmony([...hslList, hexToHsl(outer.hex || '#888')]) > 0.75)) {
      picks.push(outer);
      hslList.push(hexToHsl(outer.hex || '#888'));
    }
  }

  // shoes
  const shoes = bestOfCategory(wardrobe, 'Shoes', mood, hslList, exclude, picks);
  if (shoes) { picks.push(shoes); hslList.push(hexToHsl(shoes.hex || '#888')); }

  // accessory — only if it doesn't reduce running harmony by > 0.05
  const beforeHarmony = groupHarmony(hslList);
  const accessory = bestOfCategory(wardrobe, 'Accessory', mood, hslList, exclude, picks);
  if (accessory) {
    const afterHarmony = groupHarmony([...hslList, hexToHsl(accessory.hex || '#888')]);
    if (afterHarmony >= beforeHarmony - 0.05) {
      picks.push(accessory);
      hslList.push(hexToHsl(accessory.hex || '#888'));
    }
  }

  const harmony = groupHarmony(hslList);
  const avgMood = hslList.reduce((sum, h) => sum + moodFitScore(h, mood), 0) / (hslList.length || 1);

  const colorStory = harmony > 0.8
    ? 'These pieces share closely related or neutral tones, so they read as one deliberate palette.'
    : harmony > 0.55
    ? 'The colors sit in a complementary relationship — enough contrast to feel put-together rather than matched.'
    : 'The palette leans eclectic — it works, but the colors don\u2019t lean on each other much.';

  const weatherFit = needsOuterwear
    ? (picks.some(p => (p.category || p.cat) === 'Outerwear')
        ? 'Outerwear is included to handle the ' + weather.toLowerCase() + ' conditions.'
        : 'No outerwear was available in the closet for ' + weather.toLowerCase() + ' conditions — consider adding one.')
    : avoidOuterwear
    ? 'Kept light and layer-free for the ' + weather.toLowerCase() + ' weather.'
    : 'A comfortable balance for ' + weather.toLowerCase() + ' conditions.';

  const moodFit = avgMood > 0.65
    ? `The tones and finishes lean into a ${mood.toLowerCase()} feel.`
    : `A reasonable, if not perfect, match for a ${mood.toLowerCase()} mood — the closet may be light on options here.`;

  const confidence = (harmony > 0.75 && avgMood > 0.6) ? 'high' : (harmony > 0.5 ? 'medium' : 'low');

  return {
    pick_ids: picks.map((p) => String(p.id)),
    color_story: colorStory,
    weather_fit: weatherFit,
    mood_fit: moodFit,
    confidence
  };
}

// ---------- AI-based outfit builder ----------

async function requestAiOutfit(wardrobe, ctx, apiKey) {
  const { weather, temp, mood, occasion } = ctx;
  const wardrobeForPrompt = wardrobe.map((i) => ({
    id: String(i.id), name: i.name, description: i.description || undefined,
    category: i.category || i.cat, size: i.size || undefined, hex: i.hex
  }));

  const prompt = `You are a thoughtful, concise personal stylist. Here is the person's wardrobe as JSON:
${JSON.stringify(wardrobeForPrompt)}

Today's context:
- Weather: ${weather}${temp ? ', ' + temp + '\u00b0C' : ''}
- Mood: ${mood}
- Occasion: ${occasion || 'not specified \u2014 use your best judgment'}

Choose a complete, coherent outfit using ONLY item ids from the wardrobe above (a top or a dress, a bottom if not wearing a dress, outerwear only if the weather calls for it, shoes if available, and at most one accessory). Weigh color harmony between the chosen pieces, suitability for the weather, and fit with the stated mood.

Respond with ONLY valid JSON \u2014 no markdown fences, no preamble, no trailing text \u2014 in exactly this shape:
{"pick_ids": ["id1","id2"], "color_story": "1-2 sentences on why these colors work together", "weather_fit": "1 sentence on why this suits the weather", "mood_fit": "1 sentence on why this suits the mood", "confidence": "high|medium|low"}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error('Anthropic API error (' + response.status + '): ' + errText.slice(0, 200));
  }

  const data = await response.json();
  const textBlocks = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const clean = textBlocks.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}
