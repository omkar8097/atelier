// Dependency-free RFC4180-compliant CSV utilities.
const CSV_COLUMNS = ['id', 'name', 'description', 'category', 'pattern', 'size', 'hex', 'photo'];

function csvEscapeField(value) {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(str) || str.startsWith('data:')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function itemsToCsv(items) {
  const header = CSV_COLUMNS.join(',');
  const rows = (items || []).map((item) =>
    CSV_COLUMNS.map((col) => {
      let val = item[col];
      if (col === 'category' && !val) val = item.cat;
      if (col === 'cat' && !val) val = item.category;
      if (col === 'pattern' && !val) val = 'Solid';
      return csvEscapeField(val);
    }).join(',')
  );
  return '\uFEFF' + [header, ...rows].join('\r\n');
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (char === '\r') {
      i++;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += char;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvToItems(text) {
  if (!text || !text.trim()) return [];

  let cleanText = text.trim();
  if (cleanText.charCodeAt(0) === 0xFEFF) {
    cleanText = cleanText.slice(1);
  }

  const rows = parseCsvRows(cleanText);
  if (rows.length === 0) return [];

  const rawHeader = rows[0];
  const header = rawHeader.map((h) => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
  const dataRows = rows.slice(1);

  return dataRows.map((r, idx) => {
    const rawObj = {};
    header.forEach((col, i) => {
      rawObj[col] = r[i] !== undefined ? r[i] : '';
    });

    const categoryVal = String(rawObj.category || rawObj.cat || 'Top').trim();
    const hexVal = String(rawObj.hex || '#5b6b8c').trim();

    return {
      id: Number(rawObj.id) || (idx + 1),
      name: String(rawObj.name || '').trim(),
      description: String(rawObj.description || '').trim(),
      category: categoryVal || 'Top',
      cat: categoryVal || 'Top',
      pattern: String(rawObj.pattern || 'Solid').trim() || 'Solid',
      size: String(rawObj.size || '').trim(),
      hex: (hexVal.startsWith('#') ? hexVal : '#' + hexVal) || '#5b6b8c',
      photo: String(rawObj.photo || '').trim()
    };
  });
}

function downloadCsv(csvText, filename) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });

  if (window.navigator && window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {}
  }, 1000);
}
