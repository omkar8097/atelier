# CLAUDE.md — Working notes for AI assistants on the Poshak repo

This file is context for Claude (or any AI assistant) working in this repo. Read it before
making changes. Keep it and `README.md` in sync with the code — see "Update rule" at the bottom.

## What this is

Poshak (पोशाक) is a mobile-installable PWA outfit stylist. No backend, no build tooling required
to run it — it's vanilla HTML/CSS/JS. The user's closet is stored as CSV text in `localStorage`;
outfit picks come from either the Anthropic API (user's own key, called client-side) or a local
deterministic rule-based engine.

## File map

| File | Role |
|---|---|
| `index.html` | App shell (multi-file dev version) — loads `styles.css`, `csv-utils.js`, `outfit-engine.js`, `app.js` as separate files |
| `atelier-standalone.html` | **Generated file** — same app, everything inlined into one HTML file for offline/zero-server use |
| `styles.css` | All styling, design tokens (CSS vars), light/dark theme, logo styling & style presets (`royal`, `minimal`, `heritage`) with high-clarity light backgrounds |
| `color-utils.js` | **100% Offline Photo Intelligence**: K-Means++ dominant color extraction, Sobel pattern detection, local category & title/description pre-fill heuristics |
| `app.js` | UI wiring: tabs, chips, bottom sheet, closet CRUD, photo handling, theme toggle, lightbox, calls into `outfit-engine.js`. Consumes the outfit object only by its field names (`pick_ids`, `persona`, `harmony_score`, `mood_score`, `weather_score`, `overall_score`, `confidence`, `item_justifications`, `color_story`, `weather_fit`, `mood_fit`) — it does not care which engine version produced them, so engine internals can change freely as long as that shape is preserved. |
| `csv-utils.js` | CSV parse/serialize (RFC4180-ish), `downloadCsv()` |
| `outfit-engine.js` | **v2, config/registry-driven.** The outfit engines: `buildRuleBasedOutfit()`, `requestAiOutfit()`, and `requestAiItemFields()` (Claude Vision multimodal parser). See "The outfit-reasoning engine (v2)" below before editing this file. |
| `scripts/build-standalone.js` | Node script that regenerates `atelier-standalone.html` from the other files. Uses whitespace-tolerant regexes and throws if a source tag isn't found — see "Standalone build" below. |
| `manifest.json` | PWA manifest |
| `sw.js` | Service worker — precaches the app shell, versioned by `CACHE_NAME` |
| `icons/` | App icons and logo emblem (`logo.png`, `icon-192.png`, `icon-512.png`) featuring high-visibility 54px clear vector drawing golden hanger & kurta motif on a light background |
| `.agents/rules/readme.md` | Standing rule: any code change must be reflected in README + this context file |

## Critical invariant: two copies of the app must stay in sync

`atelier-standalone.html` is **not** hand-edited — it's built from `index.html` + `styles.css` +
`csv-utils.js` + `outfit-engine.js` + `app.js` via:

```bash
node scripts/build-standalone.js
```

**Whenever you edit any of those five source files, you must re-run this script afterward**,
or the standalone build will silently drift out of date. If Node isn't available in the
environment, at minimum flag to the user that the standalone file needs regenerating.

`build-standalone.js` now throws an error (rather than silently no-op'ing) if it can't find the
`<link rel="stylesheet">` tag or the three `<script src>` tags in `index.html` to replace — this
was previously an exact-whitespace string match that failed silently on reformatting and shipped
a stale "standalone" file that still pointed at external `.js`/`.css` files. If you ever see that
error, `index.html`'s `<head>`/script-tag markup has drifted from what the regex expects; update
either `index.html` back to the expected tags or the regex in `build-standalone.js`, not both
independently.

## Data model

One wardrobe item = one CSV row, columns in this exact order (see `CSV_COLUMNS` in
`csv-utils.js`):

```
id,name,description,category,pattern,size,hex,photo
```

- `category` is one of the 18 granular categories in `CATEGORIES` (`app.js`) — legacy broad
  categories (`Top`, `Bottom`, `Dress`, `Outerwear`, `Shoes`, `Accessory`) still parse correctly
  via the `CATEGORY_ROLES` registry in `outfit-engine.js` (see below).
- `pattern` is one of: `Solid`, `Striped`, `Plaid`, `Floral`, `Textured`. `Striped`/`Plaid`/`Floral`
  are treated as "busy" patterns (`BUSY_PATTERNS` in `outfit-engine.js`) and the rule engine
  enforces at most one busy pattern among main garments (Top/Bottom/Dress/Outerwear/Ethnic Wear)
  per outfit.
- `photo` is a base64 data URL, preserving full original image resolution and quality before storage.
- Items also carry a legacy `cat` alias mirroring `category` — some older code paths read `cat`
  as a fallback. Keep both fields in sync when creating/editing items.
- Local storage keys: `poshak_csv` (wardrobe CSV; falls back to reading legacy `atelier_csv` if
  present), `poshak_api_key` (Anthropic key), `poshak_theme` (`'light'`/`'dark'`), `poshak_logo_style` (`'royal'`/`'minimal'`/`'heritage'`).

## The outfit-reasoning engine (v2)

`outfit-engine.js` was refactored to be **config/registry-driven** and to produce **dynamic,
combination-aware reasoning** instead of static per-category templates. Before editing this
file, understand these three layers:

1. **`ENGINE_CONFIG`** — every tunable number lives here: `shortlistWeights` (mood/color/formality
   weights used when scoring candidates within a role), `scoreWeights` (harmony/mood/weather
   weights used to roll up the outfit-level scorecard), `confidence` (overall-score cutoffs for
   high/medium/low), `shortlistSize` (top-N candidates per role), `pickBiasExponent` (how greedy
   the weighted-random pick is toward the best-scoring candidate). Change engine behavior by
   editing this object, not by hunting for magic numbers throughout the functions.

2. **Registries, not hardcoded switches** — `MOOD_PROFILES`, `WEATHER_RULES`, and
   `CATEGORY_ROLES` are plain objects that the scoring functions read from. Add to them via
   `registerMoodProfile(name, target)`, `registerWeatherCondition(bucket, weatherName)`, and
   `registerCategoryRole(categoryName, role)` — these can be called from anywhere (e.g. a future
   settings screen) without editing `moodFitScore()`, `getSopRole()`, etc. All three, plus
   `ENGINE_CONFIG`, `buildRuleBasedOutfit`, and `requestAiOutfit`, are exposed on
   `window.PoshakOutfitEngine` for exactly this kind of external extension.

3. **Dynamic reasoning generation** — `generateItemJustification()` no longer returns a
   templated sentence per role. For each picked item it: converts its hex to HSL and names a
   hue family (`hueFamilyName`) and depth (`describeDepth`); finds the *actual* best-matching
   companion piece among the other real picks (`findCompanion`) and describes their real color
   relationship (`hueRelationLabel`); reports its real computed mood-fit percentage
   (`moodFitScore`); and compares its real formality (`getItemFormality`) against the context's
   target formality (`getContextFormality`). Sentence openers are chosen deterministically per
   item id from a small phrase bank (`pickVariant`) so multiple items in one outfit don't read
   as the same template with nouns swapped in. `buildColorStory()`, `buildWeatherFit()`, and
   `buildMoodFit()` do the equivalent at the outfit level — they name the two pieces with the
   best/worst pairwise harmony (`findHarmonyExtremes`) and the piece most responsible for the
   mood score, and report the real numeric sub-scores rather than only a qualitative band.

   **If you add a new role, category, or mood, also extend the relevant phrase banks /
   registries** (`OPENERS` in `generateItemJustification`, `MOOD_PROFILES`, `CATEGORY_ROLES`) —
   the scoring math will work with defaults, but the reasoning text quality depends on these.

Both engines return the same shape, now including `engine_version` (`ENGINE_VERSION`, currently
`'2.0.0'`) and `engine_source` (`'rules'` or `'ai'`), so `renderResult()` in `app.js` can render
either identically and future code can distinguish outfits produced by different engine
versions. **If you change the returned object's shape, update the AI prompt's JSON schema
description in `requestAiOutfit()` *and* `renderResult()` in `app.js`, which expects those exact
keys.**

The AI path's prompt (`requestAiOutfit`) explicitly instructs Claude to ground its reasoning in
the real picked pieces (name a companion item, cite real hex/tone, vary sentence structure)
rather than return generic boilerplate — keep this instruction if you edit the prompt, since it's
what keeps AI-mode reasoning as specific as rule-based mode's.

## Service worker / cache versioning

`sw.js` precaches `SHELL_FILES` under `CACHE_NAME = 'poshak-v12'`. **Bump this version string**
any time you change any precached file (HTML/CSS/JS/manifest/icons), or returning users will keep
getting stale cached assets. The fetch handler explicitly never intercepts `api.anthropic.com`
calls — don't add caching for that origin.

## Conventions / gotchas

- No build step for the multi-file version — `index.html` just loads plain `<script>` tags in
  order: `csv-utils.js`, `outfit-engine.js`, `app.js`.
- No frameworks, no bundler, no `node_modules` at runtime (Node is only used to run the
  standalone-build script).
- The Anthropic API key is stored in plaintext in `localStorage` and sent only to
  `api.anthropic.com`. This is called out to the user in Settings — don't quietly change that
  storage/transmission behavior without preserving/updating that disclosure.
- Keep `styles.css` and the inlined `<style>` block in `atelier-standalone.html` identical (the
  build script handles this — don't hand-edit the inlined copy).
- `outfit-engine.js` top-level `const`s (`ENGINE_CONFIG`, `MOOD_PROFILES`, etc.) are plain script
  globals, not ES module exports — both `index.html` (separate `<script src>`) and
  `atelier-standalone.html` (inlined `<script>`) rely on script-order execution, same as before.
  `window.PoshakOutfitEngine` is set defensively (`typeof window !== 'undefined'`) so the file
  also loads cleanly under Node for testing (see next point).
- To sanity-check `outfit-engine.js` changes outside the browser, run it in a Node `vm` context
  (top-level `const`s aren't `module.exports`'d, so a plain `require()` won't expose them):
  ```js
  const vm = require('vm');
  const sandbox = { console, window: {} };
  vm.createContext(sandbox);
  vm.runInContext(require('fs').readFileSync('outfit-engine.js', 'utf8'), sandbox);
  sandbox.buildRuleBasedOutfit(wardrobe, ctx, []);
  ```

## Update rule (from `.agents/rules/readme.md`)

Any code change in this repo must be followed by updating `README.md` and this `CLAUDE.md` file
so they accurately describe current behavior — feature list, file map, data model, known
limitations, and next steps should never fall out of sync with the actual code.
