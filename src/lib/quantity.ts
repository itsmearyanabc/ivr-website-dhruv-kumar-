/**
 * Quantity-based service pricing, and the number-list parsing it depends on.
 *
 * Pure and dependency-free on purpose, exactly like `@/lib/refunds`: the figure the customer
 * watches update as they type and the figure the server actually charges must come from the
 * same function. If the modal quoted one total and `createBroadcast` billed another, the
 * customer would have no way to tell which was right - and the one that moved money is the
 * one they did not see.
 *
 * This module must never import server-only code: it is bundled into the browser.
 *
 * ## The pricing model
 *
 * A service carries a `price` and the number of units that price covers (`unit_quantity`).
 * "100 SMS - Rs 11.00" is price 11, unit_quantity 100, so the rate is Rs 0.11 per unit and
 * 250 numbers cost Rs 27.50.
 *
 * `unit_quantity` NULL (or 0) means the service is *not* quantity priced and bills a flat
 * `price` per order however many numbers it carries. That is how every service behaved before
 * this feature existed, so leaving the field empty preserves it exactly - an operator has to
 * opt a service in, and no existing service silently starts charging per number.
 */

/** Rupees, rounded the way money is rounded. Mirrors the helper in `@/lib/refunds`. */
function toMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** The quantity fields of a service, as they arrive from the database. */
export type QuantityPricing = {
  price: number | string
  /** Units the price covers. NULL/0/absent = flat per-order pricing. */
  unit_quantity?: number | null
  /** Smallest order the service accepts. NULL/absent = 1. */
  min_quantity?: number | null
  /** Largest order the service accepts. NULL/absent = no ceiling. */
  max_quantity?: number | null
}

/** True when this service bills per unit rather than a flat price per order. */
export function isQuantityPriced(service: QuantityPricing): boolean {
  const units = Number(service.unit_quantity || 0)
  return Number.isFinite(units) && units > 0
}

/** Smallest order this service accepts. Always at least 1. */
export function minQuantityOf(service: QuantityPricing): number {
  const min = Number(service.min_quantity || 0)
  return Number.isFinite(min) && min > 0 ? Math.floor(min) : 1
}

/** Largest order this service accepts, or null when it is unbounded. */
export function maxQuantityOf(service: QuantityPricing): number | null {
  const max = Number(service.max_quantity || 0)
  return Number.isFinite(max) && max > 0 ? Math.floor(max) : null
}

/**
 * What one unit costs, to four decimal places.
 *
 * Kept at four rather than two because the rate is a divisor, not a ledger entry: a service
 * priced Rs 11 per 100 is Rs 0.11 exactly, but Rs 10 per 300 is Rs 0.0333, and rounding that
 * to Rs 0.03 would under-bill by 10%. Only the order total is rounded to paise.
 */
export function unitRate(service: QuantityPricing): number {
  const price = Number(service.price || 0)
  const units = Number(service.unit_quantity || 0)
  if (!Number.isFinite(price) || !Number.isFinite(units) || units <= 0) return 0
  return Math.round((price / units + Number.EPSILON) * 10000) / 10000
}

/**
 * The total for `quantity` units of this service.
 *
 * Derived from price/unit_quantity rather than from the rounded `unitRate`, so the total is
 * not amplified by the rate's own rounding error across a large order.
 *
 * A service that is not quantity priced returns its flat price, whatever the quantity - which
 * is the pre-existing behaviour and what every legacy service still does.
 */
export function quoteTotal(service: QuantityPricing, quantity: number): number {
  const price = Number(service.price || 0)
  if (!Number.isFinite(price) || price < 0) return 0
  if (!isQuantityPriced(service)) return toMoney(price)

  const units = Number(service.unit_quantity)
  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty <= 0) return 0

  return toMoney((price * qty) / units)
}

/**
 * Checks an order quantity against the service's bounds.
 *
 * Returns null when the quantity is acceptable, or the message to show the customer. The
 * wording names the actual numbers because "invalid quantity" leaves them guessing at a limit
 * they cannot see.
 */
export function validateQuantity(service: QuantityPricing, quantity: number): string | null {
  if (!isQuantityPriced(service)) return null

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 'Enter the phone numbers you want this broadcast to reach.'
  }

  const min = minQuantityOf(service)
  const max = maxQuantityOf(service)

  if (quantity < min) {
    return `This service has a minimum order of ${min.toLocaleString('en-IN')} numbers. You have entered ${quantity.toLocaleString('en-IN')}.`
  }
  if (max !== null && quantity > max) {
    return `This service has a maximum order of ${max.toLocaleString('en-IN')} numbers. You have entered ${quantity.toLocaleString('en-IN')}.`
  }
  return null
}

/**
 * What separates one entry from the next: a newline first and foremost, since the customer
 * types a number and presses enter for the next, plus the commas and semicolons a pasted
 * export arrives with. Defined once so the counter that explains a zero and the counter that
 * bills the order can never disagree about where one number ends.
 */
const SEPARATORS = /[\r\n,;]+/

/** Shortest and longest run of digits that counts as a phone number. */
const MIN_DIGITS = 10
const MAX_DIGITS = 15

/**
 * Phone numbers in a pasted, typed, or uploaded list.
 *
 * The customer types a number and presses enter for the next one, so newlines are the primary
 * separator; commas and semicolons are accepted too, because a list pasted out of a
 * spreadsheet or a contacts export arrives that way - and because a CSV row is exactly that
 * once its other columns are dropped for having no digits in them.
 *
 * Each entry is reduced to its digits before being measured, so "+91 98765 43210",
 * "+919876543210" and "98765-43210" are one number each rather than three fragments. Ten to
 * fifteen digits is the accepted range: below it are stray dates, amounts and row numbers
 * that would otherwise be billed as targets, and above it is two numbers run together on one
 * line, which is not the format the field asks for.
 *
 * Deliberately identical in the browser and on the server. The modal quotes the order from
 * this count and `createBroadcast` bills from it, so any divergence would be a customer
 * charged a total they were never shown.
 */
export function countNumbers(text: string): number {
  return parseNumbers(text).length
}

/**
 * Non-empty entries in the box, whether or not they are valid phone numbers.
 *
 * Only used to tell "nothing typed yet" apart from "plenty typed, none of it usable". Those
 * two both count zero numbers and cost zero rupees, but one of them needs an explanation and
 * the other needs to be left alone.
 */
export function countEntries(text: string): number {
  if (!text) return 0
  return text.split(SEPARATORS).filter(entry => entry.trim().length > 0).length
}

/** The individual entries `countNumbers` counts, each reduced to its digits. */
export function parseNumbers(text: string): string[] {
  if (!text) return []
  const found: string[] = []
  for (const entry of text.split(SEPARATORS)) {
    const digits = entry.replace(/\D/g, '')
    if (digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS) found.push(digits)
  }
  return found
}

/** Human-readable summary of a service's pricing, for a dropdown or a label. */
export function describePricing(service: QuantityPricing): string {
  const price = Number(service.price || 0)
  if (!isQuantityPriced(service)) return `₹${price.toFixed(2)}`

  const units = Number(service.unit_quantity)
  return `₹${price.toFixed(2)} per ${units.toLocaleString('en-IN')}`
}
