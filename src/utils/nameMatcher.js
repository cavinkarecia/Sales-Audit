export const normalizeName = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Fuzzy match for auditor names across attendance / PJP / allowance sheets. */
export const namesMatch = (a, b) => {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4) {
    return na.includes(nb) || nb.includes(na);
  }
  return false;
};

export const findByName = (records, name, nameField = 'name') => {
  return records.filter((r) => namesMatch(r[nameField] || r.employeeName, name));
};
