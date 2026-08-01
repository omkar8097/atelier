(function () {
  const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Rainy', 'Hot', 'Cold', 'Windy', 'Humid', 'Snowy'];
  const MOOD_OPTIONS = ['Confident', 'Relaxed', 'Energetic', 'Cozy', 'Professional', 'Romantic', 'Adventurous', 'Low-key'];
  const CSV_KEY = 'atelier_csv';
  const API_KEY_STORAGE = 'atelier_api_key';

  let wardrobe = [];
  let nextId = 1;
  let selectedWeather = null;
  let selectedMood = null;
  let pendingPhotoDataUrl = null;
  let editingId = null;

  const $ = (sel) => document.querySelector(sel);

  // ---------- init ----------
  $('#today-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  function buildChips(container, options, type) {
    container.innerHTML = options.map((o) => `<button class="chip" data-type="${type}" data-value="${o}">${o}</button>`).join('');
  }
  buildChips($('#weather-chips'), WEATHER_OPTIONS, 'weather');
  buildChips($('#mood-chips'), MOOD_OPTIONS, 'mood');

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
      $('#view-' + btn.dataset.view).classList.add('active');
    });
  });

  // ---------- chips ----------
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
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

  // ---------- photo handling ----------
  $('#item-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 180;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        pendingPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.72);
        $('#photo-preview').style.backgroundImage = `url(${pendingPhotoDataUrl})`;
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

  // ---------- closet CRUD ----------
  function resetForm() {
    editingId = null;
    $('#item-name').value = '';
    $('#item-desc').value = '';
    $('#item-size').value = '';
    $('#item-photo').value = '';
    $('#item-color').value = '#5b6b8c';
    pendingPhotoDataUrl = null;
    $('#photo-preview').style.backgroundImage = '';
    $('#photo-label').textContent = 'Upload photo';
    $('#form-card-title').textContent = 'Add new piece';
    $('#add-btn').textContent = 'Add to closet';
    $('#cancel-btn').style.display = 'none';
  }

  function renderCloset() {
    const el = $('#closet-list');
    if (wardrobe.length === 0) {
      el.innerHTML = '<div class="empty-note">Your closet is empty — add your first piece above.</div>';
    } else {
      el.innerHTML = wardrobe.map((item) => `
        <div class="closet-item ${editingId === item.id ? 'editing' : ''}">
          <div class="thumb" style="background-image:url(${item.photo || ''}); background-color:${item.photo ? 'transparent' : item.hex};"></div>
          <div class="info">
            <div class="name">${escapeHtml(item.name)}</div>
            ${item.description ? `<div class="desc">${escapeHtml(item.description)}</div>` : ''}
            <div class="meta">${escapeHtml(item.category || item.cat || '')}${item.size ? ' · ' + escapeHtml(item.size) : ''}</div>
          </div>
          <span class="dot" style="background:${item.hex}"></span>
          <div class="item-actions">
            <span class="edit" data-edit="${item.id}" title="Edit item">✏️</span>
            <span class="rm" data-rm="${item.id}" title="Delete item">×</span>
          </div>
        </div>
      `).join('');
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
      $('#item-cat').value = item.category || item.cat || 'Top';
      $('#item-size').value = item.size || '';
      $('#item-color').value = item.hex || '#5b6b8c';
      pendingPhotoDataUrl = item.photo || null;
      $('#photo-preview').style.backgroundImage = item.photo ? `url(${item.photo})` : '';
      $('#photo-label').textContent = item.photo ? 'Change photo' : 'Upload photo';
      $('#form-card-title').textContent = 'Editing piece';
      $('#add-btn').textContent = 'Save changes';
      $('#cancel-btn').style.display = 'block';
      renderCloset();
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

  $('#cancel-btn').addEventListener('click', resetForm);

  $('#add-btn').addEventListener('click', () => {
    const nameEl = $('#item-name');
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }

    const catValue = $('#item-cat').value;
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
        size: sizeValue,
        hex: colorValue,
        photo: pendingPhotoDataUrl || ''
      });
    }
    resetForm();
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
    try { localStorage.setItem(CSV_KEY, itemsToCsv(wardrobe)); }
    catch (err) { console.error('Local save failed', err); }
  }

  function loadWardrobe() {
    try {
      const csv = localStorage.getItem(CSV_KEY);
      if (csv) {
        wardrobe = csvToItems(csv);
        nextId = wardrobe.reduce((m, i) => Math.max(m, i.id), 0) + 1;
      }
    } catch (err) { wardrobe = []; }
    renderCloset();
  }

  $('#export-btn').addEventListener('click', () => {
    downloadCsv(itemsToCsv(wardrobe), 'atelier-closet.csv');
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
        wardrobe = imported;
      } else {
        let maxId = wardrobe.reduce((m, i) => Math.max(m, i.id), 0);
        imported.forEach((i) => { maxId++; i.id = maxId; wardrobe.push(i); });
      }
      nextId = wardrobe.reduce((m, i) => Math.max(m, i.id), 0) + 1;
      renderCloset();
      persistWardrobe();
      e.target.value = '';
    };
    reader.readAsText(file);
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
        parsed = buildRuleBasedOutfit(wardrobe, ctx);
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

    const cx = 60, cy = 60, r = 46;
    const dots = picks.map((p) => {
      const { x, y } = hueToXY(hexToHue(p.hex), r, cx, cy);
      return `<div class="dot" style="left:${x}px; top:${y}px; background:${p.hex}; position:absolute; width:16px; height:16px; border-radius:50%; border:2px solid var(--paper); box-shadow:0 0 0 1px rgba(0,0,0,0.25); transform:translate(-50%,-50%);"></div>`;
    }).join('');

    const conf = (parsed.confidence || 'medium').toLowerCase();

    resultWrap.innerHTML = `
      <div class="result-card">
        <span class="engine-tag">${useAi ? 'AI stylist' : "App's own rules"}</span>
        <div class="eyebrow">${selectedWeather} · ${selectedMood}</div>
        <h3>Today's look</h3>
        <ul class="pick-list">
          ${picks.map((p) => `
            <li>
              <div class="thumb" style="background-image:url(${p.photo || ''}); background-color:${p.photo ? 'transparent' : p.hex};"></div>
              <span class="swatch" style="background:${p.hex}"></span>
              <span>${escapeHtml(p.name)}</span>
              <span class="cat">${escapeHtml(p.category || p.cat || '')}</span>
              ${p.size ? `<span class="size">${escapeHtml(p.size)}</span>` : ''}
            </li>
          `).join('')}
        </ul>
        <div class="reasoning">
          <p><span class="label">Color story</span>${escapeHtml(parsed.color_story || '')}</p>
          <p><span class="label">Weather fit</span>${escapeHtml(parsed.weather_fit || '')}</p>
          <p><span class="label">Mood fit</span>${escapeHtml(parsed.mood_fit || '')}</p>
        </div>
        <span class="confidence">Confidence: ${conf}</span>
        <div style="position:relative;width:120px;height:120px;border-radius:50%;background:conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);opacity:0.9;margin:16px auto 0;">${dots}</div>
      </div>
    `;
  }

  // ---------- service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  loadWardrobe();
  updateCta();
})();
