/** Metadata has committed: refresh its consumers even if local workspace cleanup fails. */
export async function refreshAfterCommittedSessionMutation(
  cleanup: () => Promise<void>,
  refresh: () => Promise<unknown>,
): Promise<void> {
  try {
    await cleanup()
  } catch (cleanupError) {
    await Promise.resolve()
      .then(refresh)
      .catch(() => undefined)
    throw cleanupError
  }
  await refresh()
}
