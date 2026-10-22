const TRANSPOSITION_SPAN = 2

function isAdjacentTransposition(left: string, right: string, row: number, column: number) {
  return (
    row >= TRANSPOSITION_SPAN &&
    column >= TRANSPOSITION_SPAN &&
    left[row - 1] === right[column - TRANSPOSITION_SPAN] &&
    left[row - TRANSPOSITION_SPAN] === right[column - 1]
  )
}

/** Optimal string alignment distance: Levenshtein plus adjacent transposition. */
export function editDistance(left: string, right: string) {
  // Rows are kept as a rolling window of the last three rows needed for transpositions.
  let beforePrevious: number[] = []
  let previous = Array.from({ length: right.length + 1 }, (_, column) => column)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      const substitution =
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1)
      const best = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        substitution,
      )
      current[column] = isAdjacentTransposition(left, right, row, column)
        ? Math.min(best, (beforePrevious[column - TRANSPOSITION_SPAN] ?? 0) + 1)
        : best
    }
    beforePrevious = previous
    previous = current
  }
  return previous[right.length] ?? Number.POSITIVE_INFINITY
}
