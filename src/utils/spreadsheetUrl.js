/**
 * Robust Google Sheets URL / ID parsing.
 * Handles edit links, sharing links, gid params, and raw IDs pasted alone.
 */
export const extractSpreadsheetId = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return null;

  let url = raw;
  try {
    url = decodeURIComponent(raw);
  } catch {
    url = raw;
  }

  // Full URL patterns
  const patterns = [
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i,
    /\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/i,
    /\/spreadsheet\/ccc\?key=([a-zA-Z0-9-_]+)/i,
    /[?&]id=([a-zA-Z0-9-_]+)/i,
    /^(2PACX-[a-zA-Z0-9-_]+)$/,
    /^([a-zA-Z0-9-_]{20,})$/,
  ];

  for (const re of patterns) {
    const m = url.match(re);
    if (m?.[1]) {
      const id = m[1].split(/[/?#&]/)[0];
      if (/^[a-zA-Z0-9-_]+$/.test(id)) return id;
    }
  }

  return null;
};

export const normalizeSheetUrl = (input) => {
  const id = extractSpreadsheetId(input);
  if (!id) return null;
  return `https://docs.google.com/spreadsheets/d/${id}`;
};
