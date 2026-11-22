import { LIMITS, type AvailabilityRead, type Catalog, type RatesRead, type RestrictionsRead } from "./generated.ts";

/**
 * The rate grid as a screen wants it: rows are room types with their rate plans, columns are nights.
 * Everything here is pure (no request, no clock), so it can be tested and reused on its own.
 */

/** The six stay rules of a rate plan on a night; null = no rule set for that field. */
export type Restrictions = Omit<RestrictionsRead["cells"][number], "ratePlanId" | "date">;

export interface Grid {
  from: string;
  to: string;
  /** ISO 4217. Every price in the grid is in it. */
  currency: string;
  /** One column per night, YYYY-MM-DD in the hotel's own timezone. */
  dates: string[];
  rows: Array<{
    roomType: { id: number; name: string };
    /** date → rooms of this type left to sell */
    available: Record<string, number>;
    plans: Array<{
      ratePlan: { id: number; name: string; mealPlan: Catalog["ratePlans"][number]["mealPlan"] };
      /** date → nightly price in MAJOR units (4500 = ₹4,500.00), before any channel's modifier */
      rate: Record<string, number>;
      /** date → the stay rules */
      restrictions: Record<string, Restrictions>;
    }>;
  }>;
}

/** What a person changed on the screen: single nights, only the ones that changed. */
export interface GridEdits {
  availability?: Array<{ roomTypeId: number; date: string; available: number }>;
  /** `rate` in MAJOR units. `stopSell` closes one rate plan on a night; 0 rooms in `availability` closes the room type. Never a zero price. */
  rates?: Array<{ ratePlanId: number; date: string; rate: number }>;
  restrictions?: Array<{ ratePlanId: number; date: string } & { [K in keyof Restrictions]?: NonNullable<Restrictions[K]> }>;
}

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function ms(date: string): number {
  const t = DATE.test(date) ? Date.parse(date + "T00:00:00Z") : NaN;
  if (Number.isNaN(t)) throw new RangeError(`"${date}" is not a calendar date (YYYY-MM-DD)`);
  return t;
}

/**
 * Every night from `from` to `to`, both included. Dates are plain calendar strings: the arithmetic runs
 * in UTC, so the server's timezone can never move a night.
 */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = ms(from), end = ms(to); t <= end; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** `days` after `date` (negative goes back), as a calendar date. */
export function addDays(date: string, days: number): string {
  return new Date(ms(date) + days * DAY).toISOString().slice(0, 10);
}

/** Put the catalog and the three reads together into rows and columns. */
export function buildGrid(input: {
  from: string;
  to: string;
  catalog: Catalog;
  availability: AvailabilityRead;
  rates: RatesRead;
  restrictions: RestrictionsRead;
}): Grid {
  const rows: Grid["rows"] = input.catalog.roomTypes.map((roomType) => ({
    roomType: { id: roomType.id, name: roomType.name },
    available: {},
    plans: input.catalog.ratePlans
      .filter((plan) => plan.roomTypeId === roomType.id)
      .map((plan) => ({ ratePlan: { id: plan.id, name: plan.name, mealPlan: plan.mealPlan }, rate: {}, restrictions: {} })),
  }));
  const rowOf = new Map(rows.map((row) => [row.roomType.id, row]));
  const planOf = new Map(rows.flatMap((row) => row.plans.map((plan) => [plan.ratePlan.id, plan] as const)));

  for (const cell of input.availability.cells) {
    const row = rowOf.get(cell.roomTypeId);
    if (row) row.available[cell.date] = cell.available;
  }
  for (const cell of input.rates.cells) {
    const plan = planOf.get(cell.ratePlanId);
    if (plan) plan.rate[cell.date] = cell.rateMinor / 100; // read in minor units, shown and written in major
  }
  for (const { ratePlanId, date, ...rules } of input.restrictions.cells) {
    const plan = planOf.get(ratePlanId);
    if (plan) plan.restrictions[date] = rules;
  }
  return { from: input.from, to: input.to, currency: input.catalog.currency, dates: eachDate(input.from, input.to), rows };
}

export interface Range<V> {
  id: number;
  dateFrom: string;
  dateTo: string;
  value: V;
}

/**
 * Fold single-night edits into the fewest ranges: consecutive nights of one row that carry the same
 * value become one `{ dateFrom, dateTo }`. Thirty nights at one price are one update, not thirty. When a
 * night is given twice, the later one wins.
 */
export function toRanges<V>(cells: ReadonlyArray<{ id: number; date: string; value: V }>): Array<Range<V>> {
  const latest = new Map<string, { id: number; date: string; value: V }>();
  for (const cell of cells) latest.set(`${cell.id}|${cell.date}`, cell);
  const sorted = [...latest.values()].sort((a, b) => a.id - b.id || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: Array<Range<V>> = [];
  for (const cell of sorted) {
    const last = out[out.length - 1];
    if (last && last.id === cell.id && same(last.value, cell.value) && ms(cell.date) - ms(last.dateTo) === DAY) {
      last.dateTo = cell.date;
    } else {
      out.push({ id: cell.id, dateFrom: cell.date, dateTo: cell.date, value: cell.value });
    }
  }
  return out;
}

/** Equal values, whatever order an object's fields were written in. */
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
function stable(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

const nights = (range: { dateFrom: string; dateTo: string }) => Math.max(1, Math.round((ms(range.dateTo) - ms(range.dateFrom)) / DAY) + 1);

/** How many cells (one row on one night) a list of updates names: what the API's cells budget counts. */
export function cellsOf(updates: ReadonlyArray<{ dateFrom: string; dateTo: string }>): number {
  let cells = 0;
  for (const update of updates) cells += nights(update);
  return cells;
}

/**
 * Split updates so one request stays inside what the API takes: at most 1,000 updates and 5,000 cells
 * (a cell is one row on one night). A single update larger than a request is cut into shorter ranges.
 */
export function chunk<U extends { dateFrom: string; dateTo: string }>(
  updates: readonly U[],
  maxUpdates: number = LIMITS.maxUpdatesPerRequest,
  maxCells: number = LIMITS.maxCellsPerRequest
): U[][] {
  const pieces: U[] = [];
  for (const update of updates) {
    let from = update.dateFrom;
    while (nights({ dateFrom: from, dateTo: update.dateTo }) > maxCells) {
      const to = addDays(from, maxCells - 1);
      pieces.push({ ...update, dateFrom: from, dateTo: to });
      from = addDays(to, 1);
    }
    pieces.push(from === update.dateFrom ? update : { ...update, dateFrom: from });
  }
  const out: U[][] = [];
  let current: U[] = [];
  let cells = 0;
  for (const piece of pieces) {
    if (current.length > 0 && (current.length >= maxUpdates || cells + nights(piece) > maxCells)) {
      out.push(current);
      current = [];
      cells = 0;
    }
    current.push(piece);
    cells += nights(piece);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** A channel's price modifier: ordered steps applied to every price sent to that channel. */
export type ModifierStep = { action: "increase" | "decrease"; type: "percent" | "fixed"; value: number };

/**
 * What a channel is sent for a price, in MAJOR units: the steps applied in order. Your grid holds the
 * price before any modifier (that is what the API returns); use this to show "on Booking.com" beside it.
 */
export function channelPrice(rate: number, steps: readonly ModifierStep[]): number {
  let minor = Math.round(rate * 100);
  for (const step of steps) {
    const sign = step.action === "decrease" ? -1 : 1;
    minor = step.type === "percent" ? minor * (1 + (sign * step.value) / 100) : minor + sign * Math.round(step.value * 100);
  }
  return Math.round(minor) / 100;
}
