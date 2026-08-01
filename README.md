# Atelier — Progressive Web App

A mobile-installable outfit stylist. Your closet is stored as CSV text on your device; you choose per-request whether Claude picks the outfit or the app's own built-in styling rules do.

## Key Features

- 📱 **Standalone Mobile PWA & Offline App**: Run directly as a single-file application (`atelier-standalone.html`) or install as a PWA on iOS (Safari) and Android (Chrome).
- 👕 **Closet Management**: Add, edit, or delete items in your closet. Customize item name, description, category (Top, Bottom, Dress, Outerwear, Shoes, Accessory), size, color swatch, and compressed photo.
- ✏️ **Item Editing**: Tap the edit pencil (`✏️`) on any piece in your closet to pre-fill and update its details directly, with options to save changes or cancel.
- 🎨 **Local Rule-Based Outfit Engine**: Uses in-memory color harmony math (HSL wheel relationships), weather-based layer rules, and mood color target scoring when offline or when AI is disabled.
- 🤖 **AI Stylist Mode**: Optionally consults Claude (`claude-3-5-sonnet-latest`) using your personal Anthropic API key stored locally in browser storage when internet is connected.
- 📊 **CSV Import/Export**: Export or import your closet as RFC4180-compliant CSV data at any time.

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

## Using AI mode

1. Get an API key from console.anthropic.com.
2. Open the app → **Settings** tab → paste the key → **Save key**.
3. On the **Today** tab, flip **Use AI** on before tapping **Get my look**.

Leave **Use AI** off and the app uses its own local rules instead — no network call, no server required, no key needed.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell — three tabs: Closet (with Add/Edit form), Today, Settings |
| `atelier-standalone.html` | **Single-file standalone bundle**: Complete HTML + CSS + JS in 1 file for 100% offline file access |
| `styles.css` | Visual design system, dark theme, and PWA styling |
| `app.js` | UI wiring, closet CRUD (Add/Edit/Delete), tab navigation, local state |
| `csv-utils.js` | Reads/writes closet as CSV (parsing, escaping, category mapping, download) |
| `outfit-engine.js` | Outfit engines: `buildRuleBasedOutfit()` (local HSL/weather/mood math) and `requestAiOutfit()` (Claude API) |
| `manifest.json` | PWA install metadata (standalone display mode, maskable icons, theme colors) |
| `sw.js` | Service worker — precaches app shell (`atelier-v4`) with offline fetch fallback for standalone execution |
| `icons/` | App icons (192x192 and 512x512) for home screen installation |

## Data model (one CSV row per item)

```
id,name,description,category,size,hex,photo
1,Navy chinos,"Slim fit, cotton twill",Bottom,32,#2e3a55,"data:image/jpeg;base64,..."
```

Export/Import buttons on the Closet tab read and write this exact format.
