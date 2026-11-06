// EP-306-S9 — parses a simple duration string ("30m", "1h", "1d") into
// milliseconds, for --watch's interval. Deliberately not a general-purpose
// duration library — this only ever needs to parse a single CLI flag value.
const UNITS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(value) {
  const match = /^(\d+)(s|m|h|d)$/.exec(String(value).trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}" — expected a number followed by s/m/h/d, e.g. "30m" or "1h"`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNITS[unit];
}
