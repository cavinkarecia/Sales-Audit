import { extractSpreadsheetId } from './spreadsheetUrl.js';

/**
 * Download spreadsheet XLSX via backend proxy with clear errors.
 */
export const downloadSpreadsheetXlsx = async (urlOrId) => {
  const id = extractSpreadsheetId(urlOrId);
  if (!id) {
    throw new Error(
      'Invalid Google Sheets link. Paste the full URL from the browser (Share → Anyone with link), e.g. https://docs.google.com/spreadsheets/d/XXXX/edit',
    );
  }

  const response = await fetch(`/api/sheet?id=${encodeURIComponent(id)}`);
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    let detail = '';
    try {
      if (contentType.includes('json')) {
        const j = await response.json();
        detail = j.error || j.detail || JSON.stringify(j);
      } else {
        detail = await response.text();
      }
    } catch {
      detail = '';
    }

    if (response.status === 400) {
      throw new Error(
        detail?.includes('Invalid')
          ? `Spreadsheet ID rejected: ${detail}`
          : 'Could not open sheet (HTTP 400). Use the standard Google Sheet link format: https://docs.google.com/spreadsheets/d/<id>/edit?gid=0#gid=0',
      );
    }
    if (response.status === 403 || response.status === 401) {
      throw new Error(
        'Sheet is not public. In Google Sheets: Share → General access → Anyone with the link → Viewer, then try again.',
      );
    }
    if (response.status === 404) {
      throw new Error('Spreadsheet not found. Check the URL and that the sheet still exists.');
    }
    throw new Error(`Failed to fetch sheet (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
  }

  const buf = await response.arrayBuffer();
  if (!buf || buf.byteLength < 100) {
    throw new Error('Downloaded file is empty. Check sheet sharing permissions.');
  }
  return { id, buffer: buf };
};
