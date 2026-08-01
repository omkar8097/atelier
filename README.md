# Atelier — Progressive Web App

A mobile-installable outfit stylist. Your closet is stored as CSV text on your device; you choose per-request whether Claude picks the outfit or the app's own built-in styling rules do.

## Run it

Browsers won't run a service worker (needed for install/offline) from a plain `file://` path, so serve the folder over local HTTP:

```bash
cd atelier-pwa
npx serve .
# or: python3 -m http.server 8000
```

Then open the printed address on your phone (same Wi-Fi network) or in your desktop browser at `http://localhost:PORT`.

## Install on a phone

- **Android (Chrome)**: open the site → menu (⋮) → "Add to Home screen."
- **iOS (Safari)**: open the site → Share icon → "Add to Home Screen."

Once installed it opens full-screen like a native app and works offline for everything except the AI request (which needs a connection).

## Using AI mode

1. Get an API key from console.anthropic.com.
2. Open the app → **Settings** tab → paste the key → **Save key**.
3. On the **Today** tab, flip **Use AI** on before tapping **Get my look**.

Read the note in Settings about key exposure before sharing this app with anyone else — see `atelier-app-context.md` (or ask me) for the tradeoffs between this approach and a backend proxy.

Leave **Use AI** off and the app uses its own local rules instead — no network call, no key needed. It scores color harmony (hue relationships), a simple weather rule (adds outerwear in cold/windy/snowy conditions, skips it in hot ones), and a mood-to-color mapping (e.g. "Professional" favors muted, darker tones; "Energetic" favors bright, saturated ones) to assemble and explain a pick.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell — three tabs: Closet, Today, Settings |
| `styles.css` | Visual design |
| `app.js` | UI wiring, state, tab logic |
| `csv-utils.js` | Reads/writes the closet as CSV (parsing, escaping, download) |
| `outfit-engine.js` | Both outfit engines: `buildRuleBasedOutfit()` (no AI) and `requestAiOutfit()` (calls Claude) |
| `manifest.json` | PWA install metadata |
| `sw.js` | Service worker — caches the app shell for offline use |
| `icons/` | App icons for the home screen |

## Data model (one CSV row per item)

```
id,name,description,category,size,hex,photo
1,Navy chinos,"Slim fit, cotton twill",Bottom,32,#2e3a55,"data:image/jpeg;base64,..."
```

Export/Import buttons on the Closet tab read and write this exact format, so you can edit your closet in a spreadsheet app too if you'd rather.
