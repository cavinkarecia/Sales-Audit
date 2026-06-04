/** Fetch workbook tab list (gid + name) from server. */
export const fetchSpreadsheetTabs = async (spreadsheetId) => {
  const res = await fetch(`/api/sheet/tabs?id=${encodeURIComponent(spreadsheetId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to list tabs (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data.tabs || [];
};

export const fetchTabImages = async (spreadsheetId, gid) => {
  const res = await fetch(
    `/api/sheet/tab-images?id=${encodeURIComponent(spreadsheetId)}&gid=${encodeURIComponent(gid)}`,
  );
  if (!res.ok) return { images: [], embeddedCount: 0 };
  return res.json();
};

const normTab = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const matchTabGid = (sheetName, tabs) => {
  const n = normTab(sheetName);
  if (!n || !tabs?.length) return tabs[0]?.gid || '0';
  const exact = tabs.find((t) => normTab(t.name) === n);
  if (exact) return exact.gid;
  const partial = tabs.find((t) => normTab(t.name).includes(n) || n.includes(normTab(t.name)));
  return partial?.gid || tabs[0]?.gid || '0';
};
