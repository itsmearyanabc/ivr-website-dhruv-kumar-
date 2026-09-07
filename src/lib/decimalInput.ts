/**
 * Typing a decimal into a controlled money field.
 *
 * `<input type="number">` cannot hold a half-typed decimal. The HTML value sanitisation
 * algorithm blanks anything that is not a *valid floating-point number*, and "1." is not one -
 * a decimal point has to be followed by at least one digit. So the moment the operator presses
 * ".", the element reports `value === ""`, React writes that empty string back into state, and
 * the keystroke disappears. The field looks like it simply refuses decimals: 1 and 2 go in, 1.2
 * never can.
 *
 * The fix is to stop asking the browser to parse mid-keystroke. These fields are plain text
 * inputs with `inputMode="decimal"` - which still raises the numeric keypad on a phone - and
 * this function decides what a money field may contain, letting a trailing "." live in state
 * for exactly as long as it takes to type the next digit.
 *
 * Pure and dependency-free: it runs on every keystroke, and the value it guards is a price.
 */

/** Paise. Two decimal places, matching `NUMERIC(12,2)` on every money column in the schema. */
const MAX_DECIMALS = 2;

/**
 * The next value a money field should hold, given what the operator just typed.
 *
 * Everything that is not a digit or a decimal point is dropped, so a pasted "₹ 1,250.50"
 * becomes "1250.50" rather than being rejected outright. Only the first point survives -
 * "1.2.3" is a slip, not a number - and digits past the second decimal are refused rather than
 * rounded, because silently turning a typed 1.239 into 1.24 changes a price the operator
 * believes they set.
 *
 * A lone "." is kept as "0." so the field reads as a number being typed rather than appearing
 * to swallow the keystroke.
 */
export function sanitiseDecimalInput(raw: string): string {
  if (!raw) return '';

  const cleaned = raw.replace(/[^\d.]/g, '');
  if (!cleaned) return '';

  const [whole, ...rest] = cleaned.split('.');
  if (rest.length === 0) return whole;

  // Any further points were typed by mistake; fold the digits after them into the first part.
  const fraction = rest.join('').slice(0, MAX_DECIMALS);
  return `${whole || '0'}.${fraction}`;
}

/**
 * The number a sanitised field stands for, for arithmetic and for submitting.
 *
 * "1." and "" both mean "nothing entered yet" rather than zero, so a caller can tell an
 * in-progress decimal from a deliberate 0 and avoid quoting a price against a half-typed one.
 */
export function decimalValue(value: string): number | null {
  if (!value || value === '.' || value.endsWith('.')) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
