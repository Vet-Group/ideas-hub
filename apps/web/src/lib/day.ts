/** `YYYY-MM-DD` shifted by whole days (pure calendar arithmetic, no time zone involved). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** True for a real calendar date written `YYYY-MM-DD` from year 1, as Postgres has it (2026-02-29, 2026-13-45 and 0000-01-01 are not). */
export function isRealDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return day >= '0001-01-01' && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}
