/** Fecha de hoy en Lima (UTC−5) como "YYYY-MM-DD". */
export const hoyLimaISO = (): string => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);

/** "YYYY-MM-DD" válida en el calendario (rechaza 2026-02-31). */
export const fechaISOValida = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};
