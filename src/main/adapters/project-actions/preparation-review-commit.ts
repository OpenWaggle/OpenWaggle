/** The catalog grant must not outlive a failed Workspace snapshot save. */
export async function commitReviewedSnapshot<T>(
  save: () => Promise<T>,
  undoReview: void | (() => Promise<void>),
): Promise<T> {
  try {
    return await save()
  } catch (error) {
    if (undoReview) {
      try {
        await undoReview()
      } catch (undoError) {
        throw new AggregateError(
          [error, undoError],
          'Workspace review failed and the shared approval could not be restored. Reload and review the shared setup before using another worktree.',
          { cause: undoError },
        )
      }
    }
    throw error
  }
}
