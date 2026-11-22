/**
 * Money as the Connect API speaks it, without a float and without "divide by 100".
 *
 * The API sends and takes a price in MAJOR units (rupees, euros, yen) as a decimal string with the
 * currency's own number of decimals: "4500.50" in rupees, "89.50" in euros, "15000" in yen. `decimals`
 * comes with every such answer (`GET /property`, `GET /catalog`, `GET /rates`): pass it to these helpers
 * and they do the rest. Strings in, strings out; the arithmetic is on whole numbers, so 0.1 + 0.2 is 0.30.
 *
 * Two integers are easy to confuse, so each has its own helper:
 *   - a currency's own MINOR UNIT (ISO 4217): cents for the euro, paise for the rupee, and for the yen the
 *     yen itself. This is what most ledgers store. `amountFromMinorUnits`, `amountToMinorUnits`.
 *   - the API's `…Minor` fields (`rateMinor`, `standingMinor`): HUNDREDTHS of the major unit in EVERY
 *     currency, so 15000 yen reads 1500000. `amountFromHundredths` turns one into the string.
 */

const MICRO_DIGITS = 6;
const PLAIN = /^(-?)(\d+)(?:\.(\d+))?$/;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new RangeError(`decimals must be the currency's own count of decimal places (0, 2 or 3; it is on GET /property), not ${String(decimals)}`);
  }
}

/** A sent value as sign, digits and how many of them sit after the point. A number loses its float noise first, as the API does. */
function parse(value: number | string | bigint): { negative: boolean; digits: bigint; scale: number } {
  let text: string;
  if (typeof value === "bigint") text = value.toString();
  else if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) >= 1e15) throw new RangeError(`${String(value)} is not an amount`);
    const fixed = value.toFixed(MICRO_DIGITS);
    text = fixed.replace(/0+$/, "").replace(/\.$/, "");
  } else text = String(value).trim();
  const m = PLAIN.exec(text);
  if (!m) throw new RangeError(`"${text.slice(0, 40)}" is not an amount: write digits with an optional decimal point ("4500.50"), with no separator, symbol or space`);
  const fraction = m[3] ?? "";
  const digits = BigInt(m[2]! + fraction);
  return { negative: m[1] === "-" && digits !== 0n, digits, scale: fraction.length };
}

/** digits × 10^-scale, rounded half up (away from zero) to `decimals` places, as an integer count of the smallest unit. */
function toUnits(value: { negative: boolean; digits: bigint; scale: number }, decimals: number): bigint {
  let units: bigint;
  if (value.scale <= decimals) units = value.digits * 10n ** BigInt(decimals - value.scale);
  else {
    const cut = 10n ** BigInt(value.scale - decimals);
    units = (value.digits + cut / 2n) / cut;
  }
  return value.negative ? -units : units;
}

function fromUnits(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const text = (negative ? -units : units).toString().padStart(decimals + 1, "0");
  const whole = decimals === 0 ? text : text.slice(0, -decimals);
  return `${negative ? "-" : ""}${whole}${decimals === 0 ? "" : "." + text.slice(-decimals)}`;
}

/**
 * Any amount as the string the API reads and writes: exactly the currency's decimals, rounded half up
 * when it has more (the API does the same, and names what it rounded in the answer's `rounded` list).
 *
 * @example
 * toAmount(4500.5, 2);      // "4500.50"
 * toAmount("4500.505", 2);  // "4500.51"
 * toAmount(15000, 0);       // "15000"
 */
export function toAmount(value: number | string, decimals: number): string {
  assertDecimals(decimals);
  return fromUnits(toUnits(parse(value), decimals), decimals);
}

/**
 * From a whole number of the currency's own minor unit (cents, paise; for a currency without decimals,
 * the unit itself) to the API's string. Use it when your ledger stores integers.
 *
 * @example
 * amountFromMinorUnits(450050, 2); // "4500.50"   (paise)
 * amountFromMinorUnits(15000, 0);  // "15000"     (yen have no smaller unit)
 */
export function amountFromMinorUnits(units: number | bigint, decimals: number): string {
  assertDecimals(decimals);
  if (typeof units === "number" && !Number.isSafeInteger(units)) throw new RangeError(`${String(units)} is not a whole number of minor units`);
  return fromUnits(BigInt(units), decimals);
}

/**
 * From the API's string to a whole number of the currency's own minor unit, for a ledger that stores
 * integers. An amount with more decimals than the currency has is rounded half up first.
 *
 * @example
 * amountToMinorUnits("4500.50", 2); // 450050
 * amountToMinorUnits("15000", 0);   // 15000
 */
export function amountToMinorUnits(amount: number | string, decimals: number): number {
  assertDecimals(decimals);
  const units = toUnits(parse(amount), decimals);
  const asNumber = Number(units);
  if (!Number.isSafeInteger(asNumber)) throw new RangeError("The amount is too large to hold as a whole number of minor units");
  return asNumber;
}

/**
 * From one of the API's `…Minor` fields (`rateMinor`, `defaultRateMinor`, `standingMinor`) to the string.
 * Those fields are HUNDREDTHS of the major unit in every currency, whatever the currency's own decimals:
 * 15000 yen is `rateMinor: 1500000`. Prefer the string beside the field (`rate`); use this where an older
 * answer or your own stored copy has only the integer.
 *
 * @example
 * amountFromHundredths(450050, 2);  // "4500.50"
 * amountFromHundredths(1500000, 0); // "15000"
 */
export function amountFromHundredths(minor: number, decimals: number): string {
  assertDecimals(decimals);
  if (!Number.isSafeInteger(minor)) throw new RangeError(`${String(minor)} is not a whole number of hundredths`);
  return fromUnits(toUnits({ negative: minor < 0, digits: BigInt(Math.abs(minor)), scale: 2 }, decimals), decimals);
}

/** The sum of two amounts, in the currency's decimals. */
export function addAmounts(a: number | string, b: number | string, decimals: number): string {
  assertDecimals(decimals);
  return fromUnits(toUnits(parse(a), decimals) + toUnits(parse(b), decimals), decimals);
}

/** `a` minus `b`, in the currency's decimals. */
export function subtractAmounts(a: number | string, b: number | string, decimals: number): string {
  assertDecimals(decimals);
  return fromUnits(toUnits(parse(a), decimals) - toUnits(parse(b), decimals), decimals);
}

/**
 * An amount times a factor (nights, a quantity, a percentage as "1.18"), rounded half up to the currency's
 * decimals once, at the end.
 *
 * @example
 * multiplyAmount("4500.50", 3, 2);     // "13501.50"   three nights
 * multiplyAmount("89.50", "1.10", 2);  // "98.45"      ten per cent on top
 */
export function multiplyAmount(amount: number | string, factor: number | string, decimals: number): string {
  assertDecimals(decimals);
  const a = parse(amount);
  const f = parse(factor);
  return fromUnits(toUnits({ negative: a.negative !== f.negative, digits: a.digits * f.digits, scale: a.scale + f.scale }, decimals), decimals);
}

/** -1 when `a` is less than `b`, 1 when it is more, 0 when they are the same amount ("4500.5" and "4500.50" are). */
export function compareAmounts(a: number | string, b: number | string): -1 | 0 | 1 {
  const x = toUnits(parse(a), MICRO_DIGITS);
  const y = toUnits(parse(b), MICRO_DIGITS);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * An amount for a person to read, in their own way of writing numbers: the currency's symbol or code, its
 * decimals, the locale's separators. `locale` defaults to the runtime's.
 *
 * @example
 * formatAmount("4500.50", { currency: "INR", decimals: 2, locale: "en-IN" }); // "₹4,500.50"
 * formatAmount("15000", { currency: "JPY", decimals: 0, locale: "ja-JP" });   // "￥15,000"
 */
export function formatAmount(amount: number | string, options: { currency: string; decimals: number; locale?: string }): string {
  const text = toAmount(amount, options.decimals);
  const format = new Intl.NumberFormat(options.locale, { style: "currency", currency: options.currency, minimumFractionDigits: options.decimals, maximumFractionDigits: options.decimals });
  // A decimal string is formatted digit for digit (no float in between) on every runtime this package supports.
  return (format.format as unknown as (value: string) => string)(text);
}
