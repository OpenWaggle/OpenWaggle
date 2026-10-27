/**
 * Loads a module on its first use instead of when the bundle starts. Every OpenWaggle process
 * (GUI, Session Host, each CLI call) evaluates the main bundle's whole static graph at startup,
 * so a static import of a native or many-file package costs every process its load time even if
 * it never uses it (startup-main.md, A-F4). A failed load is not cached: the next call retries.
 */
export function lazyModule<Module>(load: () => Promise<Module>): () => Promise<Module> {
  let pending: Promise<Module> | null = null
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }
}
