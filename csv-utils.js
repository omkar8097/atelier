// Minimal, dependency-free RFC4180-style CSV utilities.
// Handles quoted fields, embedded commas/quotes/newlines (needed for the
// description field; the base64 photo strings never contain these
// characters, but we quote everything defensively anyway).

const CSV_COLUMNS = ['id', 'name', 'description', 'category', 'size', 'hex', 'photo'];

function csvEscapeField(value) {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function itemsToCsv(items) {
  const header = CSV_COLUMNS.join(',');
  const rows = items.map((item) =>
    CSV_COLUMNS.map((col) => csvEscapeField(item[col])).join(',')
  );
  return [header, ...rows].join('\r\n');
}

// Parses raw CSV text into an array of row-arrays, respecting quoted fields.
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

  // flush trailing field/row (file may not end with a newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvToItems(text) {
  if (!text || !text.trim()) return [];
  const rows = parseCsvRows(text.trim());
  if (rows.length === 0) return [];

  const header = rows[0];
  const dataRows = rows.slice(1);

  return dataRows.map((r) => {
    const obj = {};
    header.forEach((col, idx) => {
      obj[col] = r[idx] !== undefined ? r[idx] : '';
    });
    obj.id = Number(obj.id) || 0;
    return obj;
  });
}

function downloadCsv(csvText, filename) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
