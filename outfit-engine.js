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

// ---------- weather & SOP mappings ----------

const COLD_WEATHER = ['Cold', 'Snowy', 'Windy'];
const HOT_WEATHER = ['Hot', 'Sunny', 'Humid'];
const BUSY_PATTERNS = ['Striped', 'Plaid', 'Floral'];
const MAIN_ROLES = ['Top', 'Bottom', 'Dress', 'Ethnic Wear', 'Outerwear'];

const ROLE_MAP = {
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

function getSopRole(item) {
  const cat = item.category || item.cat || 'Top';
  return ROLE_MAP[cat] || 'Top';
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
function shortlistOfRole(items, role, mood, baseHslList, currentPicks = [], targetFormality = 'smart-casual', topN = 3) {
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

  const scored = pool.map((item) => {
    const hsl = hexToHsl(item.hex || '#888888');
    const mScore = moodFitScore(hsl, mood);
    const cScore = baseHslList.length ? groupHarmony([...baseHslList, hsl]) : 1;
    const fType = getItemFormality(item);
    const fScore = fType === targetFormality ? 1.0 : (fType === 'smart-casual' ? 0.8 : 0.6);
    return { item, score: mScore * 0.35 + cScore * 0.45 + fScore * 0.20 };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.min(topN, scored.length));
}

function weightedPick(shortlist, excludeIds = []) {
  if (shortlist.length === 0) return null;
  let pool = shortlist.filter((c) => !excludeIds.includes(String(c.item.id)));
  if (pool.length === 0) pool = shortlist;

  const weights = pool.map((c) => Math.pow(Math.max(c.score, 0.01), 3));
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

function generateItemJustification(item, ctx, role, harmonyScore, moodScore) {
  const cat = item.category || item.cat || role;
  const mood = ctx.mood || 'general';
  const weather = ctx.weather || 'mild';
  const formality = getItemFormality(item);

  if (role === 'Top') {
    return `${cat} "${item.name}" provides a versatile upper-body base. Its color aligns seamlessly with the ${mood.toLowerCase()} mood and keeps overall palette harmony at ${harmonyScore}%.`;
  }
  if (role === 'Bottom') {
    return `${cat} "${item.name}" pairs structure and comfort for ${weather.toLowerCase()} conditions, offering clean visual balance with your top piece.`;
  }
  if (role === 'Dress') {
    return `${cat} "${item.name}" serves as an elegant standalone outfit base, delivering cohesive tone and style for a ${mood.toLowerCase()} feel.`;
  }
  if (role === 'Ethnic Wear') {
    return `Traditional ${cat} "${item.name}" anchors the outfit with cultural flair, offering rich texture and an ideal fit for ${ctx.occasion || 'the occasion'}.`;
  }
  if (role === 'Outerwear') {
    return `${cat} "${item.name}" adds functional warmth and layer depth suited for ${weather.toLowerCase()} weather without overwhelming the base silhouette.`;
  }
  if (role === 'Footwear') {
    return `${cat} "${item.name}" grounds the ensemble with appropriate ${formality} formality, completing the look comfortably from head to toe.`;
  }
  return `Accent ${cat} "${item.name}" adds subtle polished contrast, enhancing overall visual appeal.`;
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
  const needsOuterwear = COLD_WEATHER.includes(weather);
  const avoidOuterwear = HOT_WEATHER.includes(weather);
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

  const harmonyScore = Math.round(rawHarmony * 100);
  const moodScore = Math.round(avgMood * 100);
  const weatherScore = Math.round(weatherMatch * 100);
  const overallScore = Math.round(harmonyScore * 0.40 + moodScore * 0.35 + weatherScore * 0.25);

  const confidence = overallScore >= 85 ? 'high' : (overallScore >= 65 ? 'medium' : 'low');

  // Item justifications map
  const itemJustifications = {};
  picks.forEach((item) => {
    const role = getSopRole(item);
    itemJustifications[String(item.id)] = generateItemJustification(item, ctx, role, harmonyScore, moodScore);
  });

  const personaNames = {
    formal: 'Sharp Professional Elegance',
    ethnic: 'Festive Ethnic Sophistication',
    casual: 'Relaxed & Breathable Casual',
    'smart-casual': 'Smart-Casual Modern Ensemble'
  };

  const persona = personaNames[targetFormality] || 'Custom Styled Ensemble';

  const colorStory = rawHarmony > 0.8
    ? 'These pieces share closely related or neutral tones, creating a clean, high-harmony palette.'
    : rawHarmony > 0.55
    ? 'The colors sit in a balanced, complementary relationship — enough contrast to feel energetic without clashing.'
    : 'An eclectic palette that introduces interesting contrast across garments.';

  const weatherFit = needsOuterwear
    ? (picks.some(p => getSopRole(p) === 'Outerwear')
        ? `Outerwear layer included to protect against ${weather.toLowerCase()} conditions.`
        : `Selected pieces for ${weather.toLowerCase()} weather; adding outerwear will further boost warmth.`)
    : avoidOuterwear
    ? `Light, unlayered silhouette curated for ${weather.toLowerCase()} conditions.`
    : `A balanced, comfortable ensemble suited for ${weather.toLowerCase()} weather.`;

  const moodFit = avgMood > 0.65
    ? `The tones and silhouettes strongly evoke a ${mood.toLowerCase()} mood.`
    : `A suitable match for a ${mood.toLowerCase()} mood based on available closet pieces.`;

  return {
    pick_ids: picks.map((p) => String(p.id)),
    persona,
    harmony_score: harmonyScore,
    mood_score: moodScore,
    weather_score: weatherScore,
    overall_score: overallScore,
    confidence,
    item_justifications: itemJustifications,
    color_story: colorStory,
    weather_fit: weatherFit,
    mood_fit: moodFit
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
    "id1": "Detailed explanation why id1 was chosen...",
    "id2": "Detailed explanation why id2 was chosen..."
  },
  "color_story": "Detailed explanation of color synergy...",
  "weather_fit": "Detailed explanation of weather suitability...",
  "mood_fit": "Detailed explanation of mood alignment..."
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
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}
