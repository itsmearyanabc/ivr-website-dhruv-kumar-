/**
 * Failed-call refund arithmetic.
 *
 * Deliberately pure and dependency-free so that the admin's live preview and the server's
 * authoritative recomputation run the *same* function. If the preview said one figure and
 * the server credited another, the operator would have no way to tell which was right, and
 * the number they approved would not be the number that moved.
 *
 * The rate is derived from the order rather than looked up: `broadcasts.charge` is what that
 * customer was actually billed, already reflecting any per-customer price in force at the
 * time. Reading a price table now would silently reprice history whenever the catalogue
 * changed, so an order refunded six months late is refunded at the rate it was sold at.
 */

/** Rupees, rounded the way money is rounded. Avoids 0.1 + 0.2 landing in the ledger. */
function toMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export type RefundBreakdown =
  | {
      ok: true
      /** delivered + failed, the denominator the rate is derived from. */
      totalCalls: number
      /** charge / totalCalls - shown to the operator so the figure is checkable by hand. */
      perCallRate: number
      /** What will actually be credited, after capping. */
      refund: number
      /** True when the raw calculation was reduced to fit what is still refundable. */
      capped: boolean
      /** The uncapped figure, present only when `capped` is true. */
      uncapped?: number
    }
  | { ok: false; error: string }

/**
 * Splits an order's charge across its calls and returns the value of the failed ones.
 *
 * @param charge              what the order was billed, from `broadcasts.charge`
 * @param delivered           calls that connected, off the fulfilment report
 * @param failed              calls that did not, off the fulfilment report
 * @param refundableRemaining charge minus everything already credited back on this order
 */
export function calculateFailedCallRefund(
  charge: number,
  delivered: number,
  failed: number,
  refundableRemaining: number,
): RefundBreakdown {
  if (!Number.isFinite(charge) || charge <= 0) {
    return { ok: false, error: 'This order has no charge to refund against.' }
  }
  if (!Number.isInteger(delivered) || delivered < 0) {
    return { ok: false, error: 'Delivered calls must be a whole number, zero or more.' }
  }
  if (!Number.isInteger(failed) || failed < 0) {
    return { ok: false, error: 'Failed calls must be a whole number, zero or more.' }
  }

  const totalCalls = delivered + failed
  if (totalCalls <= 0) {
    return { ok: false, error: 'Enter how many calls were delivered and how many failed.' }
  }

  const perCallRate = toMoney(charge / totalCalls)
  const raw = toMoney((charge * failed) / totalCalls)

  // Never pay back more than is still owed. An order that was already partly refunded, or
  // one being closed out a second time, must not hand the customer the same money twice.
  if (raw > refundableRemaining) {
    return {
      ok: true,
      totalCalls,
      perCallRate,
      refund: toMoney(Math.max(0, refundableRemaining)),
      capped: true,
      uncapped: raw,
    }
  }

  return { ok: true, totalCalls, perCallRate, refund: raw, capped: false }
}
