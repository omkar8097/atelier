(function () {
  const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Rainy', 'Hot', 'Cold', 'Windy', 'Humid', 'Snowy'];
  const MOOD_OPTIONS = ['Confident', 'Relaxed', 'Energetic', 'Cozy', 'Professional', 'Romantic', 'Adventurous', 'Low-key'];
  const CSV_KEY = 'poshak_csv';
  const API_KEY_STORAGE = 'poshak_api_key';
  const THEME_KEY = 'poshak_theme';
  const LOGO_STYLE_KEY = 'poshak_logo_style';

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

  // ---------- logo style preset ----------
  function applyLogoStyle(style) {
    document.documentElement.setAttribute('data-logo-style', style || 'royal');
    document.querySelectorAll('.logo-chip').forEach((c) => {
      c.classList.toggle('sel', c.dataset.logoStyle === (style || 'royal'));
    });
  }

  function loadLogoStyle() {
    try { return localStorage.getItem(LOGO_STYLE_KEY) || 'royal'; }
    catch (err) { return 'royal'; }
  }

  let currentLogoStyle = loadLogoStyle();
  applyLogoStyle(currentLogoStyle);

  const logoChips = $('#logo-style-chips');
  if (logoChips) {
    logoChips.addEventListener('click', (e) => {
      const btn = e.target.closest('.logo-chip');
      if (!btn) return;
      currentLogoStyle = btn.dataset.logoStyle;
      try { localStorage.setItem(LOGO_STYLE_KEY, currentLogoStyle); } catch (err) {}
      applyLogoStyle(currentLogoStyle);
    });
  }

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
      if (viewName === 'review') renderReview();
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

  // ---------- photo handling & 100% offline auto-fill ----------
  function runOfflineAutoFill(canvas) {
    if (!window.PoshakColorUtils) return;
    try {
      const colors = PoshakColorUtils.extractDominantColors(canvas);
      const patternGuess = PoshakColorUtils.detectPattern(canvas);
      const offlineFill = PoshakColorUtils.detectCategoryAndSmartFill(canvas, colors, patternGuess);

      if (colors && colors[0]) {
        $('#item-color').value = colors[0].hex;
      }
      if (patternGuess && patternGuess.pattern) {
        $('#item-pattern').value = patternGuess.pattern;
      }
      if (offlineFill) {
        if (!$('#item-name').value.trim()) $('#item-name').value = offlineFill.title;
        if (!$('#item-desc').value.trim()) $('#item-desc').value = offlineFill.description;
        const cat = offlineFill.category;
        $('#item-cat').value = cat;
        document.querySelectorAll('.cat-chip').forEach((c) => c.classList.toggle('sel', c.dataset.cat === cat));
      }
    } catch (err) {
      console.error('Offline auto-fill failed', err);
    }
  }

  $('#item-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingPhotoDataUrl = ev.target.result;
      $('#photo-preview').style.backgroundImage = `url(${pendingPhotoDataUrl})`;
      $('#photo-preview').dataset.full = pendingPhotoDataUrl;
      $('#photo-label').textContent = 'Change photo';
      const autofillBtn = $('#autofill-btn');
      if (autofillBtn) autofillBtn.disabled = false;

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 200;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          runOfflineAutoFill(canvas);
          const status = $('#autofill-status');
          if (status) status.textContent = 'Auto-filled 100% offline from photo.';
        } catch (err) { /* leave fields as-is */ }
      };
      img.src = pendingPhotoDataUrl;
    };
    reader.readAsDataURL(file);
  });

  const autofillBtn = $('#autofill-btn');
  if (autofillBtn) {
    autofillBtn.addEventListener('click', async () => {
      if (!pendingPhotoDataUrl) return;
      const status = $('#autofill-status');
      const apiKey = loadApiKey();

      status.textContent = 'Analyzing photo...';
      autofillBtn.disabled = true;

      try {
        if (apiKey && navigator.onLine) {
          status.textContent = 'Consulting AI vision for item details...';
          const fields = await requestAiItemFields(pendingPhotoDataUrl, apiKey);
          if (fields.name) $('#item-name').value = fields.name;
          if (fields.description) $('#item-desc').value = fields.description;
          if (fields.category) {
            $('#item-cat').value = fields.category;
            document.querySelectorAll('.cat-chip').forEach((c) => c.classList.toggle('sel', c.dataset.cat === fields.category));
          }
          if (fields.pattern) $('#item-pattern').value = fields.pattern;
          if (fields.size_guess) $('#item-size').value = fields.size_guess;
          status.textContent = '✨ Fields refined via AI Vision.';
        } else {
          // 100% offline auto-fill
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxDim = 200;
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            runOfflineAutoFill(canvas);
            status.textContent = 'Auto-filled 100% offline from photo.';
          };
          img.src = pendingPhotoDataUrl;
        }
      } catch (err) {
        status.textContent = 'Offline detection active. (AI unavailable: ' + (err.message || 'offline') + ')';
      } finally {
        autofillBtn.disabled = false;
      }
    });
  }

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
    const ab = $('#autofill-btn');
    if (ab) ab.disabled = true;
    const st = $('#autofill-status');
    if (st) st.textContent = '';
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

  // ---------- Personal Stylist Profile ----------
  const PROFILE_KEY = 'poshak_user_profile';
  let pendingProfilePhotoDataUrl = null;

  function loadUserProfile() {
    try {
      const data = localStorage.getItem(PROFILE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (err) { return null; }
  }

  function saveUserProfile(profile) {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (err) {}
    renderUserProfileCard(profile);
  }

  function renderUserProfileCard(profile) {
    const wrap = $('#profile-details-wrap');
    if (!wrap) return;
    if (!profile) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = 'block';
    $('#profile-skin-badge').textContent = profile.skinTone || 'Wheatish';
    $('#profile-season-badge').textContent = (profile.undertone ? profile.undertone + ' · ' : '') + (profile.season || 'Warm Autumn');
    $('#profile-body-badge').textContent = profile.bodyShape || 'Rectangle / Athletic';

    const swatchesEl = $('#profile-swatches');
    if (swatchesEl) {
      const colors = profile.bestColors || ['#C99A3E', '#8C5E75', '#7C8F6E', '#C47F3B'];
      swatchesEl.innerHTML = colors.map(hex => `<span style="width:20px;height:20px;border-radius:50%;background:${hex};display:inline-block;border:1px solid rgba(0,0,0,0.15);" title="${hex}"></span>`).join('');
    }

    const adviceEl = $('#profile-advice-text');
    if (adviceEl) adviceEl.textContent = profile.advice || 'Tailored cuts and harmonious palettes complement your personal silhouette.';
  }

  async function runProfileAnalysis() {
    if (!pendingProfilePhotoDataUrl) return;
    const status = $('#profile-status');
    const btn = $('#analyze-profile-btn');
    const apiKey = loadApiKey();
    if (btn) btn.disabled = true;

    status.textContent = 'Analyzing skin tone & body silhouette...';

    try {
      let profile;
      if (apiKey && navigator.onLine) {
        status.textContent = 'Consulting AI Vision for personal profile analysis...';
        const aiData = await analyzePersonalProfileAi(pendingProfilePhotoDataUrl, apiKey);
        profile = {
          skinTone: aiData.skin_tone,
          undertone: aiData.undertone,
          season: aiData.color_season,
          bestColors: aiData.best_hex_colors || ['#C99A3E', '#8C5E75', '#7C8F6E', '#C47F3B'],
          avoidColors: aiData.avoid_hex_colors || ['#E5E5E5'],
          bodyShape: aiData.body_shape,
          advice: aiData.styling_advice
        };
      } else {
        const img = new Image();
        await new Promise((resolve) => {
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              const maxDim = 300;
              const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
              canvas.width = Math.round(img.width * scale);
              canvas.height = Math.round(img.height * scale);
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              profile = PoshakColorUtils.analyzePersonalProfile(canvas);
            } catch (err) {
              console.error('Local profile analysis error', err);
            }
            resolve();
          };
          img.onerror = () => resolve();
          img.src = pendingProfilePhotoDataUrl;
        });
      }
      if (profile) {
        profile.photo = pendingProfilePhotoDataUrl;
        saveUserProfile(profile);
        status.textContent = '✨ Profile analyzed & saved 100% locally.';
      } else {
        status.textContent = 'Could not process image metrics.';
      }
    } catch (err) {
      status.textContent = 'Profile analysis failed: ' + (err.message || 'Error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const userProfilePhotoInput = $('#user-profile-photo');
  if (userProfilePhotoInput) {
    userProfilePhotoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        pendingProfilePhotoDataUrl = ev.target.result;
        const prev = $('#user-profile-preview');
        if (prev) prev.style.backgroundImage = `url(${pendingProfilePhotoDataUrl})`;
        runProfileAnalysis();
      };
      reader.readAsDataURL(file);
    });
  }

  const analyzeProfileBtn = $('#analyze-profile-btn');
  if (analyzeProfileBtn) {
    analyzeProfileBtn.addEventListener('click', () => {
      runProfileAnalysis();
    });
  }

  // Load existing profile on start
  const initialProfile = loadUserProfile();
  if (initialProfile) {
    if (initialProfile.photo) {
      const prev = $('#user-profile-preview');
      if (prev) prev.style.backgroundImage = `url(${initialProfile.photo})`;
    }
    renderUserProfileCard(initialProfile);
  }

  $('#clear-data-btn').addEventListener('click', () => {
    if (!confirm('Remove every closet item and photo from this device? This cannot be undone.')) return;
    wardrobe = [];
    nextId = 1;
    persistWardrobe();
    renderCloset();
  });

  const refreshAppBtn = $('#refresh-app-btn');
  if (refreshAppBtn) {
    refreshAppBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }

  // Disable accidental keyboard refresh (F5 / Ctrl+R / Cmd+R)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
      e.preventDefault();
    }
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

        ${loadUserProfile() ? `
        <div style="background:var(--bg-elevated);padding:10px 12px;border-radius:var(--radius);margin-top:12px;font-size:11.5px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-weight:600;color:var(--accent-ochre);">👤 Personal Fit Match</span>
            <span style="font-weight:700;color:var(--success);">94% Fit</span>
          </div>
          <div style="color:var(--text-dim);font-size:10.5px;line-height:1.35;">
            Tailored for your <strong>${escapeHtml(loadUserProfile().skinTone || 'Wheatish')} (${escapeHtml(loadUserProfile().undertone || 'Warm Golden')})</strong> skin tone & <strong>${escapeHtml(loadUserProfile().bodyShape || 'Athletic')}</strong> frame.
          </div>
        </div>
        ` : ''}

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

  // ---------- closet review ----------
  const aiReviewToggle = $('#ai-review-toggle');
  if (aiReviewToggle) {
    aiReviewToggle.addEventListener('change', (e) => {
      $('#ai-review-sub').textContent = e.target.checked
        ? 'Analyzes wardrobe via Claude AI'
        : 'Uses built-in closet analysis rules';
      renderReview();
    });
  }

  async function renderReview() {
    const wrap = $('#review-wrap');
    if (!wrap) return;

    if (wardrobe.length === 0) {
      wrap.innerHTML = `<div class="empty-note" style="margin-top:20px;">Your closet is empty. Add your first pieces using the + button to unlock closet review insights.</div>`;
      return;
    }

    const useAi = $('#ai-review-toggle') ? $('#ai-review-toggle').checked : false;
    if (useAi) {
      const apiKey = loadApiKey();
      if (!apiKey) {
        wrap.innerHTML = `<div class="status-line err" style="margin-top:16px;">No API key saved yet — add one in Settings, or turn AI off to use built-in rules.</div>`;
        return;
      }
    }

    wrap.innerHTML = `<div class="status-line" style="margin-top:16px;"><span class="spinner"></span>${useAi ? 'Consulting AI for closet review…' : 'Analyzing wardrobe readiness…'}</div>`;

    try {
      let data;
      if (useAi) {
        data = await requestAiClosetReview(wardrobe, loadApiKey());
      } else {
        data = analyzeClosetReadiness(wardrobe);
      }
      displayReviewData(data, useAi);
    } catch (err) {
      wrap.innerHTML = `<div class="status-line err" style="margin-top:16px;">${escapeHtml(err.message || "Couldn't review closet.")}</div>`;
    }
  }

  function displayReviewData(data, useAi) {
    const wrap = $('#review-wrap');
    const scenarios = data.scenarios || [];
    const missingRecs = data.missing_recommendations || [];

    wrap.innerHTML = `
      <div class="result-card">
        <span class="engine-tag">${useAi ? 'AI Closet Review' : 'Rule-Based Review'}</span>
        <h3>Wardrobe Overview</h3>
        <p style="font-size:13px;line-height:1.6;color:var(--text-on-surface);margin-bottom:16px;">${escapeHtml(data.inventory_summary || '')}</p>

        <h4 style="font-family:'Fraunces',serif;font-size:16px;margin:16px 0 10px;">Scenario & Occasion Readiness</h4>
        ${scenarios.map((s) => {
          const score = s.score || 0;
          const scoreColor = score >= 80 ? 'var(--success)' : (score >= 50 ? 'var(--accent-amber)' : 'var(--danger)');
          return `
            <div class="scenario-card">
              <div class="scenario-card-header">
                <span class="scenario-card-title">${escapeHtml(s.name)}</span>
                <span class="scenario-score-badge" style="color:${scoreColor}">${score}%</span>
              </div>
              <div class="scenario-bar-bg">
                <div class="scenario-bar-fill" style="width:${score}%;background:${scoreColor};"></div>
              </div>
              <div class="scenario-desc">${escapeHtml(s.description)}</div>
            </div>
          `;
        }).join('')}

        ${missingRecs.length > 0 ? `
          <h4 style="font-family:'Fraunces',serif;font-size:16px;margin:20px 0 10px;">Recommended Additions & Colors</h4>
          ${missingRecs.map((r) => `
            <div class="rec-card">
              <div class="rec-title">${escapeHtml(r.item_type)}</div>
              <div class="rec-reason">${escapeHtml(r.reason)}</div>
              <div class="rec-items-label">Suggested Items:</div>
              <div>
                ${(r.suggested_items || []).map((i) => `<span class="rec-item-pill">${escapeHtml(i)}</span>`).join('')}
              </div>
              ${(r.matching_colors && r.matching_colors.length > 0) ? `
                <div class="rec-items-label" style="margin-top:10px;">Matching Color Recommendations:</div>
                <div class="rec-swatch-group">
                  ${r.matching_colors.map((c) => `
                    <div class="swatch-chip" title="${escapeHtml(c.reason || '')}">
                      <span class="dot" style="background:${c.hex}"></span>
                      <span>${escapeHtml(c.name)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        ` : `
          <div class="status-line" style="margin-top:14px;color:var(--success);">Your closet covers all essential categories cleanly!</div>
        `}
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
