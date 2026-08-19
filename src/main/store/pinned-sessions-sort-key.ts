/**
 * Fractional index keys for Manual order of Pinned sessions (ADR 0019).
 *
 * A pin stores a **string** sort key rather than an integer position, so inserting
 * between two neighbours writes exactly one row and never renumbers the rest. That
 * single-row property is what lets a future cross-device sync merge pins one at a
 * time instead of picking a winning device. Do not "fix" this into a position
 * integer — that reintroduces renumbering writes and destroys the merge property.
 *
 * Keys are compared with plain lexicographic `<` over `DIGITS`. A key never ends in
 * the lowest digit, because nothing can sort between `"a0"` and `"a"` — such a key
 * would be unsplittable, so it is rejected as input and never produced as output.
 */

/** Ordered key alphabet: lexicographic order over these equals their index order. */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
const LOWEST_DIGIT = DIGITS[0]
/** Exclusive lower bound for an unbounded start: sorts before every valid key. */
const UNBOUNDED_START = ''
const HALF = 0.5

function digitValue(character: string) {
  const value = DIGITS.indexOf(character)
  if (value < 0) throw new Error(`Invalid sort-key digit: ${JSON.stringify(character)}`)
  return value
}

function assertSplittable(key: string, label: string) {
  for (const character of key) digitValue(character)
  if (key.endsWith(LOWEST_DIGIT)) {
    throw new Error(`${label} sort key must not end with "${LOWEST_DIGIT}": ${key}`)
  }
}

/**
 * A key strictly between `before` and `after`.
 *
 * `before` is `""` for an unbounded start; `after` is `null` for an unbounded end.
 * Precondition: `before < after`, and neither ends in the lowest digit.
 */
function midpoint(before: string, after: string | null): string {
  if (after !== null && before >= after) {
    throw new Error(`Sort keys out of order: ${JSON.stringify(before)} >= ${after}`)
  }

  if (after !== null) {
    // Copy the shared prefix, then split the first position where they differ.
    let shared = 0
    while ((before[shared] ?? LOWEST_DIGIT) === after[shared]) shared += 1
    if (shared > 0) {
      return after.slice(0, shared) + midpoint(before.slice(shared), after.slice(shared))
    }
  }

  const low = before === '' ? 0 : digitValue(before[0])
  const high = after === null ? BASE : digitValue(after[0])

  if (high - low > 1) {
    // A gap exists in this position: land in the middle of it and stop.
    return DIGITS[Math.round(HALF * (low + high))]
  }
  if (after !== null && after.length > 1) {
    // Digits are adjacent but `after` continues, so its own first digit is free.
    return after.slice(0, 1)
  }
  // Adjacent digits with nothing to borrow: keep the low digit and extend right.
  return DIGITS[low] + midpoint(before.slice(1), null)
}

/**
 * A key strictly between `before` and `after`, either of which may be `null`
 * to mean unbounded. `keyBetween(null, null)` opens a sequence,
 * `keyBetween(last, null)` appends, `keyBetween(null, first)` prepends.
 */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null) assertSplittable(before, 'before')
  if (after !== null) assertSplittable(after, 'after')
  return midpoint(before ?? UNBOUNDED_START, after)
}

/** Append after the last key of a sequence already sorted ascending. */
export function keyAtEnd(sortedKeys: readonly string[]): string {
  return keyBetween(sortedKeys.at(-1) ?? null, null)
}
