(function () {
  const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Rainy', 'Hot', 'Cold', 'Windy', 'Humid', 'Snowy'];
  const MOOD_OPTIONS = ['Confident', 'Relaxed', 'Energetic', 'Cozy', 'Professional', 'Romantic', 'Adventurous', 'Low-key'];
  const CSV_KEY = 'poshak_csv';
  const API_KEY_STORAGE = 'poshak_api_key';
  const THEME_KEY = 'poshak_theme';

  const CATEGORIES = [
    { name: 'Casual Shirt', role: 'Top', color: 'var(--accent-blue)' },
    { name: 'Formal Shirt', role: 'Top', color: '#4A7BB0' },
    { name: 'T-Shirt / Polo', role: 'Top', color: '#3B93C4' },
    { name: 'Kurta', role: 'Top', color: '#8A5BA7' },
    { name: 'Formal Trousers', role: 'Bottom', color: 'var(--accent-sage)' },
    { name: 'Chinos', role: 'Bottom', color: '#688B58' },
    { name: 'Jeans', role: 'Bottom', color: '#4F7C85' },
    { name: 'Shorts', role: 'Bottom', color: '#8F9B58' },
    { name: 'Pyjamas / Trackpants', role: 'Bottom', color: '#7A8B7B' },
    { name: 'Dress / One-Piece', role: 'Dress', color: 'var(--accent-rose)' },
    { name: 'Saree / Ethnic Set', role: 'Ethnic Wear', color: '#9C5B8B' },
    { name: 'Jacket / Blazer / Coat', role: 'Outerwear', color: 'var(--accent-amber)' },
    { name: 'Nehru Jacket / Dupatta', role: 'Outerwear', color: '#C47F3B' },
    { name: 'Formal Shoes / Loafers', role: 'Footwear', color: '#8C6E4F' },
    { name: 'Sneakers / Casual Shoes', role: 'Footwear', color: '#9E7856' },
    { name: 'Juttis / Kolhapuris / Sandals', role: 'Footwear', color: '#A06E3B' },
    { name: 'Watch / Belt / Sunglasses', role: 'Accessory', color: 'var(--accent-ochre)' },
    { name: 'Jewelry / Bags', role: 'Accessory', color: '#D4A03A' }
  ];

  const CATEGORY_COLORS = {
    Top: 'var(--accent-blue)',
    Bottom: 'var(--accent-sage)',
    Dress: 'var(--accent-rose)',
    'Ethnic Wear': '#9C5B8B',
    Outerwear: 'var(--accent-amber)',
    Footwear: '#8C6E4F',
    Accessory: 'var(--accent-ochre)'
  };

  const CONFIDENCE_COLOR = {
    high: 'var(--success)',
    medium: 'var(--accent-amber)',
    low: 'var(--danger)'
  };

  function getItemColor(catName) {
    const found = CATEGORIES.find((c) => c.name === catName);
    if (found) return found.color;
    if (CATEGORY_COLORS[catName]) return CATEGORY_COLORS[catName];
    return 'var(--accent-sage)';
  }

  let wardrobe = [];
  let nextId = 1;
  let selectedWeather = null;
  let selectedMood = null;
  let pendingPhotoDataUrl = null;
  let editingId = null;

  const recentOutfitsByContext = new Map();

  function contextKey(ctx) {
    return [ctx.weather, ctx.mood, ctx.occasion || ''].join('|');
  }

  function getRecentPickIds(ctx) {
    const key = contextKey(ctx);
    const history = recentOutfitsByContext.get(key) || [];
    return history.length ? history[history.length - 1] : [];
  }

  function rememberOutfit(ctx, pickIds) {
    const key = contextKey(ctx);
    const history = recentOutfitsByContext.get(key) || [];
    history.push(pickIds);
    if (history.length > 3) history.shift();
    recentOutfitsByContext.set(key, history);
  }

  const $ = (sel) => document.querySelector(sel);

  // ---------- theme engine (runs immediately) ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#FBF7EF' : '#20261F');
  }

  function loadTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (err) {}
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  let currentTheme = loadTheme();
  applyTheme(currentTheme);

  $('#theme-toggle').checked = currentTheme === 'light';
  $('#theme-toggle').addEventListener('change', (e) => {
    currentTheme = e.target.checked ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, currentTheme); } catch (err) {}
    applyTheme(currentTheme);
  });

  // ---------- init ----------
  $('#today-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  function buildChips(container, options, type) {
    container.innerHTML = options.map((o) => `<button class="chip" data-type="${type}" data-value="${o}">${o}</button>`).join('');
  }
  buildChips($('#weather-chips'), WEATHER_OPTIONS, 'weather');
  buildChips($('#mood-chips'), MOOD_OPTIONS, 'mood');

  function buildCategoryChips() {
    $('#item-cat-chips').innerHTML = CATEGORIES.map((c) =>
      `<button type="button" class="chip cat-chip ${c.name === 'Casual Shirt' ? 'sel' : ''}" data-cat="${c.name}" style="--chip-color:${c.color}">${c.name}</button>`
    ).join('');
  }
  buildCategoryChips();

  $('#item-cat-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-chip');
    if (!btn) return;
    const cat = btn.dataset.cat;
    $('#item-cat').value = cat;
    document.querySelectorAll('.cat-chip').forEach((c) => c.classList.toggle('sel', c.dataset.cat === cat));
  });

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ---------- tab navigation ----------
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      const viewName = btn.dataset.view;
      $('#view-' + viewName).classList.add('active');
      const fab = $('#add-fab');
      if (fab) fab.style.display = viewName === 'closet' ? 'flex' : 'none';
    });
  });

  // ---------- chips ----------
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || chip.classList.contains('cat-chip')) return;
    const type = chip.dataset.type, value = chip.dataset.value;
    if (type === 'weather') {
      selectedWeather = selectedWeather === value ? null : value;
      document.querySelectorAll('.chip[data-type="weather"]').forEach((c) => c.classList.toggle('sel', c.dataset.value === selectedWeather));
    } else if (type === 'mood') {
      selectedMood = selectedMood === value ? null : value;
      document.querySelectorAll('.chip[data-type="mood"]').forEach((c) => {
        c.classList.add('mood');
        c.classList.toggle('sel', c.dataset.value === selectedMood);
      });
    }
    updateCta();
  });

  // ---------- photo handling (480px resolution bump) ----------
  $('#item-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 480;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        pendingPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.75);
        $('#photo-preview').style.backgroundImage = `url(${pendingPhotoDataUrl})`;
        $('#photo-preview').dataset.full = pendingPhotoDataUrl;
        $('#photo-label').textContent = 'Change photo';
        try {
          const data = ctx.getImageData(0, 0, w, h).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < data.length; i += 16) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
          if (n > 0) {
            r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
            $('#item-color').value = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
          }
        } catch (err) { /* leave color as-is */ }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  // ---------- bottom sheet controls ----------
  function openSheet() {
    $('#item-sheet').classList.add('open');
    $('#sheet-backdrop').classList.add('open');
    $('#item-sheet').setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    $('#item-sheet').classList.remove('open');
    $('#sheet-backdrop').classList.remove('open');
    $('#item-sheet').setAttribute('aria-hidden', 'true');
    resetForm();
  }

  const fabBtn = $('#add-fab');
  if (fabBtn) fabBtn.addEventListener('click', () => { resetForm(); openSheet(); });

  const headerAddBtn = $('#header-add-btn');
  if (headerAddBtn) headerAddBtn.addEventListener('click', () => { resetForm(); openSheet(); });

  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#cancel-btn').addEventListener('click', closeSheet);

  // ---------- closet CRUD ----------
  function resetForm() {
    editingId = null;
    $('#item-name').value = '';
    $('#item-desc').value = '';
    $('#item-cat').value = 'Casual Shirt';
    document.querySelectorAll('.cat-chip').forEach((c) => c.classList.toggle('sel', c.dataset.cat === 'Casual Shirt'));
    $('#item-pattern').value = 'Solid';
    $('#item-size').value = '';
    $('#item-photo').value = '';
    $('#item-color').value = '#5b6b8c';
    pendingPhotoDataUrl = null;
    $('#photo-preview').style.backgroundImage = '';
    $('#photo-preview').dataset.full = '';
    $('#photo-label').textContent = 'Upload photo';
    $('#form-card-title').textContent = 'Add new piece';
    $('#add-btn').textContent = 'Add to closet';
  }

  function renderCloset() {
    const el = $('#closet-list');
    if (wardrobe.length === 0) {
      el.innerHTML = `
        <div class="empty-note">
          Your closet is empty.
          <div style="margin-top:10px;">
            <button class="btn btn-primary" id="empty-add-btn" style="width:auto;padding:8px 16px;font-size:11.5px;display:inline-block;">+ Add piece</button>
          </div>
        </div>
      `;
      const emptyAdd = $('#empty-add-btn');
      if (emptyAdd) {
        emptyAdd.addEventListener('click', () => { resetForm(); openSheet(); });
      }
    } else {
      el.innerHTML = wardrobe.map((item) => {
        const cat = item.category || item.cat || 'Casual Shirt';
        const catColor = getItemColor(cat);
        return `
          <div class="closet-item ${editingId === item.id ? 'editing' : ''}" style="--cat-color:${catColor}">
            <div class="thumb" data-full="${item.photo || ''}" style="background-image:url(${item.photo || ''}); background-color:${item.photo ? 'transparent' : item.hex};"></div>
            <div class="info">
              <div class="name">${escapeHtml(item.name)}</div>
              ${item.description ? `<div class="desc">${escapeHtml(item.description)}</div>` : ''}
              <div class="meta">
                <span style="color:${catColor};font-weight:600;">${escapeHtml(cat)}</span>
                ${item.pattern && item.pattern !== 'Solid' ? ' · ' + escapeHtml(item.pattern) : ''}
                ${item.size ? ' · ' + escapeHtml(item.size) : ''}
              </div>
              <div class="footer-row">
                <span class="dot" style="background:${item.hex}"></span>
                <div class="item-actions">
                  <span class="edit" data-edit="${item.id}" title="Edit item">✏️</span>
                  <span class="rm" data-rm="${item.id}" title="Delete item">×</span>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
    updateCta();
  }

  document.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      const id = Number(editBtn.dataset.edit);
      const item = wardrobe.find((i) => i.id === id);
      if (!item) return;
      editingId = item.id;
      $('#item-name').value = item.name || '';
      $('#item-desc').value = item.description || '';
      const cat = item.category || item.cat || 'Casual Shirt';
      $('#item-cat').value = cat;
      document.querySelectorAll('.cat-chip').forEach((c) => c.classList.toggle('sel', c.dataset.cat === cat));
      $('#item-pattern').value = item.pattern || 'Solid';
      $('#item-size').value = item.size || '';
      $('#item-color').value = item.hex || '#5b6b8c';
      pendingPhotoDataUrl = item.photo || null;
      $('#photo-preview').style.backgroundImage = item.photo ? `url(${item.photo})` : '';
      $('#photo-preview').dataset.full = item.photo || '';
      $('#photo-label').textContent = item.photo ? 'Change photo' : 'Upload photo';
      $('#form-card-title').textContent = 'Editing piece';
      $('#add-btn').textContent = 'Save changes';
      renderCloset();
      openSheet();
      $('#item-name').focus();
      return;
    }

    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const id = Number(rm.dataset.rm);
      wardrobe = wardrobe.filter((i) => i.id !== id);
      if (editingId === id) resetForm();
      renderCloset();
      persistWardrobe();
      return;
    }
  });

  $('#add-btn').addEventListener('click', () => {
    const nameEl = $('#item-name');
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }

    const catValue = $('#item-cat').value;
    const patternValue = $('#item-pattern').value;
    const descValue = $('#item-desc').value.trim();
    const sizeValue = $('#item-size').value.trim();
    const colorValue = $('#item-color').value;

    if (editingId) {
      const item = wardrobe.find((i) => i.id === editingId);
      if (item) {
        item.name = name;
        item.description = descValue;
        item.category = catValue;
        item.cat = catValue;
        item.pattern = patternValue;
        item.size = sizeValue;
        item.hex = colorValue;
        if (pendingPhotoDataUrl !== null) {
          item.photo = pendingPhotoDataUrl;
        }
      }
    } else {
      wardrobe.push({
        id: nextId++,
        name,
        description: descValue,
        category: catValue,
        cat: catValue,
        pattern: patternValue,
        size: sizeValue,
        hex: colorValue,
        photo: pendingPhotoDataUrl || ''
      });
    }
    closeSheet();
    renderCloset();
    persistWardrobe();
  });

  function updateCta() {
    const btn = $('#suggest-btn');
    const note = $('#cta-note');
    const ready = wardrobe.length >= 2 && selectedWeather && selectedMood;
    btn.disabled = !ready;
    note.textContent = ready ? 'Ready when you are.' : 'Add at least 2 pieces, a weather chip, and a mood to continue.';
  }

  // ---------- CSV persistence (local "database") ----------
  function persistWardrobe() {
    try {
      if (wardrobe.length === 0) {
        localStorage.removeItem(CSV_KEY);
      } else {
        localStorage.setItem(CSV_KEY, itemsToCsv(wardrobe));
      }
      recentOutfitsByContext.clear();
    } catch (err) {
      console.error('Local save failed', err);
    }
  }

  function loadWardrobe() {
    try {
      const csv = localStorage.getItem(CSV_KEY) || localStorage.getItem('atelier_csv');
      if (csv) {
        wardrobe = csvToItems(csv);
        nextId = wardrobe.reduce((m, i) => Math.max(m, i.id), 0) + 1;
      }
    } catch (err) { wardrobe = []; }
    renderCloset();
  }

  $('#export-btn').addEventListener('click', () => {
    downloadCsv(itemsToCsv(wardrobe), 'poshak-closet.csv');
  });

  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const imported = csvToItems(ev.target.result);
      if (imported.length === 0) {
        alert('No rows found in that CSV.');
        return;
      }
      const replace = confirm(`Import ${imported.length} item(s)? OK replaces your current closet, Cancel adds them to it.`);
      if (replace) {
        let maxId = 0;
        imported.forEach((item) => {
          maxId++;
          item.id = maxId;
        });
        wardrobe = imported;
      } else {
        let maxId = wardrobe.reduce((m, i) => Math.max(m, i.id), 0);
        imported.forEach((i) => {
          maxId++;
          i.id = maxId;
        });
        wardrobe = wardrobe.concat(imported);
      }
      nextId = wardrobe.reduce((m, i) => Math.max(m, i.id), 0) + 1;
      renderCloset();
      persistWardrobe();
      e.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  });

  // ---------- settings / API key ----------
  function loadApiKey() {
    try { return localStorage.getItem(API_KEY_STORAGE) || ''; }
    catch (err) { return ''; }
  }
  $('#api-key-input').value = loadApiKey();

  $('#save-key-btn').addEventListener('click', () => {
    try {
      localStorage.setItem(API_KEY_STORAGE, $('#api-key-input').value.trim());
      $('#key-status').textContent = 'Saved.';
      setTimeout(() => { $('#key-status').textContent = ''; }, 2000);
    } catch (err) {
      $('#key-status').textContent = 'Could not save the key on this device.';
    }
  });

  $('#clear-data-btn').addEventListener('click', () => {
    if (!confirm('Remove every closet item and photo from this device? This cannot be undone.')) return;
    wardrobe = [];
    nextId = 1;
    persistWardrobe();
    renderCloset();
  });

  // ---------- AI toggle ----------
  $('#ai-toggle').addEventListener('change', (e) => {
    $('#ai-sub').textContent = e.target.checked
      ? 'Calls Claude for the pick'
      : "Uses the app's own styling rules";
  });

  // ---------- get outfit ----------
  $('#suggest-btn').addEventListener('click', getOutfit);

  async function getOutfit() {
    const btn = $('#suggest-btn');
    const resultWrap = $('#result-wrap');
    const useAi = $('#ai-toggle').checked;
    const ctx = {
      weather: selectedWeather,
      temp: $('#temp-input').value.trim(),
      mood: selectedMood,
      occasion: $('#occasion-input').value.trim()
    };

    if (useAi) {
      const apiKey = loadApiKey();
      if (!apiKey) {
        resultWrap.innerHTML = `<div class="status-line err">No API key saved yet — add one in Settings, or turn AI off to use the app's own rules.</div>`;
        return;
      }
    }

    btn.disabled = true;
    resultWrap.innerHTML = `<div class="status-line"><span class="spinner"></span>${useAi ? 'Consulting the AI stylist…' : 'Applying the styling rules…'}</div>`;

    try {
      let parsed;
      if (useAi) {
        parsed = await requestAiOutfit(wardrobe, ctx, loadApiKey());
      } else {
        const recentIds = getRecentPickIds(ctx);
        parsed = buildRuleBasedOutfit(wardrobe, ctx, recentIds);
        rememberOutfit(ctx, parsed.pick_ids);
      }
      renderResult(parsed, useAi);
    } catch (err) {
      resultWrap.innerHTML = `<div class="status-line err">${escapeHtml(err.message || "Couldn't get a suggestion.")} <span style="text-decoration:underline;cursor:pointer;" id="retry-btn">Try again</span></div>`;
      const retry = document.getElementById('retry-btn');
      if (retry) retry.addEventListener('click', getOutfit);
    } finally {
      btn.disabled = false;
    }
  }

  function hexToHue(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    if (max !== min) {
      if (max === r) h = 60 * (((g - b) / (max - min)) % 6);
      else if (max === g) h = 60 * (((b - r) / (max - min)) + 2);
      else h = 60 * (((r - g) / (max - min)) + 4);
    }
    if (h < 0) h += 360;
    return h;
  }

  function hueToXY(hue, r, cx, cy) {
    const rad = (hue - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function renderResult(parsed, useAi) {
    const resultWrap = $('#result-wrap');
    const picks = (parsed.pick_ids || []).map((id) => wardrobe.find((i) => String(i.id) === String(id))).filter(Boolean);

    if (picks.length === 0) {
      resultWrap.innerHTML = `<div class="status-line err">Couldn't match any pieces from your closet. Try adding more variety and ask again.</div>`;
      return;
    }

    $('#suggest-btn').textContent = 'Get another look';

    const cx = 60, cy = 60, r = 46;
    const dots = picks.map((p) => {
      const { x, y } = hueToXY(hexToHue(p.hex), r, cx, cy);
      return `<div class="dot" style="left:${x}px; top:${y}px; background:${p.hex}; position:absolute; width:16px; height:16px; border-radius:50%; border:2px solid var(--surface); box-shadow:0 0 0 1px rgba(0,0,0,0.25); transform:translate(-50%,-50%);"></div>`;
    }).join('');

    const conf = (parsed.confidence || 'medium').toLowerCase();
    const confColor = CONFIDENCE_COLOR[conf] || 'var(--accent-amber)';

    const overallScore = parsed.overall_score || (conf === 'high' ? 92 : (conf === 'medium' ? 76 : 58));
    const harmonyScore = parsed.harmony_score || 88;
    const moodScore = parsed.mood_score || 82;
    const weatherScore = parsed.weather_score || 90;
    const justifications = parsed.item_justifications || {};

    resultWrap.innerHTML = `
      <div class="result-card">
        <span class="engine-tag">${useAi ? 'AI stylist' : "App's own rules"}</span>
        <div class="eyebrow">${selectedWeather} · ${selectedMood}</div>
        <h3>Today's look</h3>
        <span class="persona-tag">${escapeHtml(parsed.persona || 'Curated Style Ensemble')}</span>

        <!-- Scorecard Breakdown -->
        <div class="scorecard">
          <div class="scorecard-header">
            <span class="overall">Style Confidence</span>
            <span class="percentage" style="color:${confColor}">${overallScore}%</span>
          </div>
          <div class="score-metrics">
            <div class="score-row">
              <span class="label-text">Color Harmony</span>
              <div class="score-bar-bg"><div class="score-bar-fill" style="width:${harmonyScore}%;background:var(--accent-blue);"></div></div>
              <span class="val">${harmonyScore}%</span>
            </div>
            <div class="score-row">
              <span class="label-text">Mood Fit</span>
              <div class="score-bar-bg"><div class="score-bar-fill" style="width:${moodScore}%;background:var(--accent-plum);"></div></div>
              <span class="val">${moodScore}%</span>
            </div>
            <div class="score-row">
              <span class="label-text">Weather Fit</span>
              <div class="score-bar-bg"><div class="score-bar-fill" style="width:${weatherScore}%;background:var(--accent-sage);"></div></div>
              <span class="val">${weatherScore}%</span>
            </div>
          </div>
        </div>

        <ul class="pick-list">
          ${picks.map((p) => {
            const cat = p.category || p.cat || 'Casual Shirt';
            const catColor = getItemColor(cat);
            const justification = justifications[String(p.id)] || `Selected ${cat} "${p.name}" to balance visual harmony and formality.`;
            return `
              <li>
                <div class="pick-header">
                  <div class="thumb" data-full="${p.photo || ''}" style="background-image:url(${p.photo || ''}); background-color:${p.photo ? 'transparent' : p.hex};"></div>
                  <span class="swatch" style="background:${p.hex}"></span>
                  <span>${escapeHtml(p.name)}</span>
                  <span class="cat" style="color:${catColor}">${escapeHtml(cat)}${p.pattern && p.pattern !== 'Solid' ? ' (' + escapeHtml(p.pattern) + ')' : ''}</span>
                  ${p.size ? `<span class="size">${escapeHtml(p.size)}</span>` : ''}
                </div>
                <div class="item-rationale">${escapeHtml(justification)}</div>
              </li>
            `;
          }).join('')}
        </ul>
        <div class="reasoning">
          <p><span class="label">Color story</span>${escapeHtml(parsed.color_story || '')}</p>
          <p><span class="label">Weather suitability</span>${escapeHtml(parsed.weather_fit || '')}</p>
          <p><span class="label">Mood & occasion fit</span>${escapeHtml(parsed.mood_fit || '')}</p>
        </div>
        <span class="confidence" style="background:${confColor};color:#ffffff;">Confidence: ${conf} (${overallScore}%)</span>
        <div style="position:relative;width:120px;height:120px;border-radius:50%;background:conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);opacity:0.9;margin:16px auto 0;">${dots}</div>
      </div>
    `;
  }

  // ---------- image lightbox ----------
  function openLightbox(url) {
    if (!url) return;
    $('#lightbox-img').src = url;
    $('#lightbox').classList.add('open');
    $('#lightbox').setAttribute('aria-hidden', 'false');
  }

  function closeLightbox() {
    $('#lightbox').classList.remove('open');
    $('#lightbox').setAttribute('aria-hidden', 'true');
    setTimeout(() => { $('#lightbox-img').src = ''; }, 200);
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.item-actions')) return;
    const el = e.target.closest('[data-full]');
    if (el) {
      const fullUrl = el.dataset.full;
      if (fullUrl) openLightbox(fullUrl);
    }
  });

  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') closeLightbox();
  });
  $('#lightbox-close').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });

  // ---------- service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  loadWardrobe();
  updateCta();
})();
