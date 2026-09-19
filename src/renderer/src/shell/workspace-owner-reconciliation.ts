/** Native ownership is already committed: finish every in-memory transfer even
 * when a persisted Zustand write throws after updating its in-memory state. */
export function collectOwnerReconciliationErrors(steps: readonly (() => void)[]): unknown[] {
  const errors: unknown[] = []
  for (const step of steps) {
    try {
      step()
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}
