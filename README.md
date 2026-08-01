# Poshak (पोशाक) — Desi Outfit Stylist PWA

A mobile-installable outfit stylist application. Your closet is stored as CSV text on your device; you choose per-request whether Claude picks the outfit or the app's own built-in styling rules do.

## Key Features

- 👕 **Poshak (पोशाक)**: Authentic Desi-styled wardrobe manager & outfit stylist.
- 📱 **Standalone Mobile PWA & Offline App**: Run directly as a single-file application (`atelier-standalone.html`) or install as a PWA on iOS (Safari) and Android (Chrome).
- 🏷️ **18 Granular Clothing Categories**: Full support for specific items including `Casual Shirt`, `Formal Shirt`, `T-Shirt / Polo`, `Kurta`, `Formal Trousers`, `Chinos`, `Jeans`, `Shorts`, `Pyjamas`, `Dress`, `Saree / Ethnic Set`, `Jacket / Blazer`, `Nehru Jacket / Dupatta`, `Formal Shoes / Loafers`, `Sneakers`, `Juttis / Sandals`, `Watch / Belt`, `Jewelry / Bags`.
- 📊 **Style Confidence Scorecard & Sub-Scores**: Transparent percentage meter breakdown displaying overall outfit match (e.g. `88% Match`), Color Harmony, Mood Fit, and Weather Suitability.
- 💡 **Detailed Item-by-Item Rationale & SOP Engine**: Provides individual explanations for *why* each piece was selected for the specific weather, formality, and mood context, alongside expanded Color Story, Weather Suitability, and Mood Fit rationales.
- 🌗 **Light / Dark Mode Toggle**: Instant header sun/moon switch with role-based design tokens, `prefers-color-scheme` auto-detection, and local storage persistence.
- 🎨 **Category Color System**: Dedicated color palette per category applied to card borders, pill selectors, and result lists.
- 🔍 **Tap-to-Enlarge Image Lightbox**: Tap any photo thumbnail in your closet or result recommendations to view full-resolution crisp garment photos with backdrop/Escape dismissal.
- 📱 **2-Column Closet Grid & Slide-up Bottom Sheet**: Decluttered closet view with 2-column item grid, header `+ Add piece` button, and floating `+` action button that slides open a smooth bottom sheet for adding or editing pieces.
- 🎲 **Outfit Variety Engine ("Get another look")**: Tapping "Get my look" / "Get another look" repeatedly produces distinct, high-quality outfits using top-3 shortlisting, `score^3` weighted random selection, and recent-exclusion history per weather/mood/occasion context.
- 🎨 **Pattern Matching & Color Harmony SOP**: Scores HSL hue relationships (analogous, complementary, neutrals), mood targets, formality fit, and enforces pattern rules (max 1 busy pattern like Striped/Plaid/Floral among main garments).
- 🤖 **AI Stylist Mode**: Optionally consults Claude (`claude-3-5-sonnet-latest`) using your personal Anthropic API key stored locally in browser storage when internet is connected.
- 🔍 **Review Closet Tab (Scenario Readiness & Gap Engine)**: Dedicated Review tab with AI/Rule-based toggle that analyzes total closet inventory, evaluates readiness scores across 5 scenarios (Professional, Casual, Ethnic, Summer, Winter), and recommends missing clothing items with exact matching colors.
- 🔄 **Disabled Accidental Refresh & Settings Reload**: Pull-to-refresh overscroll and keyboard reload shortcuts (F5 / Ctrl+R) are disabled to prevent accidental state resets; explicit **"Refresh App"** button provided in the Settings tab.
- 👑 **Luxury Brand Emblem & Logo Style Presets**: Gold clothes hanger & traditional kurta emblem logo icon with sub-brand lettering; supports 3 selectable style presets (Royal Emerald & Gold, Modern Minimal, Desi Heritage Arch) in Settings.
- 📊 **CSV Import/Export in Settings**: Export or import your closet as RFC4180-compliant CSV data at any time directly from the Settings tab.

## Running on Mobile (With or Without Internet)

### Option 1: Zero-Server Offline File (`atelier-standalone.html`) — Recommended for offline mobile use
1. Copy [`atelier-standalone.html`](file:///c:/Users/USER/Documents/atelier-pwa/atelier-pwa/atelier-standalone.html) to your mobile phone (via USB, AirDrop, email, or local file manager).
2. Open `atelier-standalone.html` in Chrome or Safari.
3. It works **100% offline with zero server requirements** and never shows network connection errors.

### Option 2: Local HTTP / HTTPS Server & PWA
Modern mobile browsers (Chrome / Safari) require **HTTPS** (or `localhost` / free HTTPS hosting like GitHub Pages, Vercel, or Netlify) to register offline PWA Service Workers:

```bash
cd atelier-pwa
npx serve .
```

- Open the printed `http://localhost:PORT` or `https://<YOUR_DOMAIN>` link in your browser.
- **Android (Chrome)**: Menu (⋮) → "Add to Home screen."
- **iOS (Safari)**: Share icon → "Add to Home Screen."

## Standalone Build Automation

To keep `atelier-standalone.html` automatically synchronized with `index.html`, `styles.css`, `csv-utils.js`, `outfit-engine.js`, and `app.js`, run:

```bash
node scripts/build-standalone.js
```

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell — Poshak header, Closet (with 2-col grid & sheet form), Today, Settings, Theme Switch, Lightbox |
| `atelier-standalone.html` | **Single-file standalone bundle**: Complete HTML + CSS + JS in 1 file compiled automatically via `scripts/build-standalone.js` |
| `styles.css` | Design system, role-based CSS tokens, light/dark themes, bottom sheet, FAB, scorecard, and lightbox styling |
| `app.js` | UI wiring, theme engine, 18-category system, bottom sheet controls, lightbox, scorecard, closet CRUD |
| `csv-utils.js` | Reads/writes closet as CSV (parsing, escaping, header normalization, UTF-8 BOM, download) |
| `outfit-engine.js` | Outfit engines: `buildRuleBasedOutfit()` (shortlisting, formality SOP, item justifications, scorecards) and `requestAiOutfit()` (Claude API) |
| `scripts/build-standalone.js` | Build automation script to generate `atelier-standalone.html` |
| `manifest.json` | PWA install metadata (`Poshak — Outfit Stylist`, standalone display mode, maskable icons) |
| `sw.js` | Service worker — precaches app shell (`poshak-v16`) with offline fetch fallback for standalone execution |
| `icons/` | App icons (192x192 and 512x512) for home screen installation |

## Data model (one CSV row per item)

```
id,name,description,category,pattern,size,hex,photo
1,Navy chinos,"Slim fit, cotton twill",Chinos,Solid,32,#2e3a55,"data:image/jpeg;base64,..."
```

Export/Import buttons on the Closet tab read and write this exact format.
