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
      /**
       * What this order is owed for its failed calls **in total**, across every save.
       * A function of the call counts alone, so re-entering the same counts yields the same
       * figure however many times the fulfilment is saved.
       */
      totalDue: number
      /** Already credited back on this order before this save. */
      alreadyRefunded: number
      /** What this save will actually credit: the shortfall between the two above. */
      refund: number
      /** True when earlier saves already cover what is owed, so nothing more moves. */
      settled: boolean
      /**
       * Set when more has already been credited than the current counts justify - revised
       * figures after a larger refund, say. Never clawed back automatically; the operator is
       * told so they can decide.
       */
      overRefunded?: number
    }
  | { ok: false; error: string }

/**
 * Splits an order's charge across its calls and returns what is still owed for the failed
 * ones.
 *
 * The call counts describe a *total*, not an instalment: 40 failures out of 100 on a Rs 550
 * order means Rs 220 is owed for that order, full stop. So this returns the difference
 * between that total and whatever has already been credited, which makes saving the
 * fulfilment twice a no-op instead of a second payout.
 *
 * That distinction is the whole point. Previously this returned the full Rs 220 every time
 * and relied on the caller capping it at "charge minus refunds so far", which stops the
 * customer being handed more than the order was worth but does nothing to stop the same
 * refund being paid again: re-uploading a corrected report three times credited Rs 220,
 * Rs 220 and Rs 110, refunding the entire Rs 550 of an order where 60% of the calls landed.
 *
 * @param charge          what the order was billed, from `broadcasts.charge`
 * @param delivered       calls that connected, off the fulfilment report
 * @param failed          calls that did not, off the fulfilment report
 * @param alreadyRefunded everything already credited back on this order, from the ledger
 */
export function calculateFailedCallRefund(
  charge: number,
  delivered: number,
  failed: number,
  alreadyRefunded: number,
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

  // Never more than the order was worth, however the counts are entered. A report claiming
  // more failures than there were calls billed still cannot refund more than was charged.
  const totalDue = toMoney(Math.min(charge, (charge * failed) / totalCalls))
  const paid = toMoney(Math.max(0, alreadyRefunded))
  const refund = toMoney(Math.max(0, totalDue - paid))

  return {
    ok: true,
    totalCalls,
    perCallRate,
    totalDue,
    alreadyRefunded: paid,
    refund,
    settled: refund === 0,
    ...(paid > totalDue ? { overRefunded: toMoney(paid - totalDue) } : {}),
  }
}
