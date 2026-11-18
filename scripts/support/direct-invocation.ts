import { pathToFileURL } from 'node:url'

/**
 * Runs `main` when the module at `moduleUrl` (its `import.meta.url`) is the script Node was
 * started with, not when another script imports it. A failure prints its message and sets a
 * failing exit code.
 */
export function runWhenInvokedDirectly(moduleUrl: string, main: () => Promise<void>) {
  if (process.argv[1] === undefined || moduleUrl !== pathToFileURL(process.argv[1]).href) return
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
