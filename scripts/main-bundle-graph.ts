import type { MainChunkManifestEntry } from './vite/main-chunk-manifest'

/**
 * What each kind of OpenWaggle process loads before it does its work, named by source module
 * (A-F6). Every process starts in `index.js` and then imports its own part:
 * - the desktop app's runtime, IPC and window services (src/main/index.ts, gui-backend-startup.ts);
 * - the Session Host's ownership, cutover, runtime and bootstrap (session-host-cli-entry.ts);
 * - a CLI command's module (top-level-cli-entry.ts and the `*-cli-entry.ts` files).
 * A budget counts the static closure of the entry chunk and the chunks holding these modules.
 *
 * The main bundle is one file (electron.vite.config.ts says why), so today every process loads
 * all of it and the budgets are the bundle's size: 15.8 MB when set. Splitting it into chunks
 * would let each budget fall to its own graph (GUI 2.5 MB, Host 10.2 MB, CLI 0.9-1.7 MB measured).
 */
export interface MainProcessBudget {
  readonly label: string
  readonly startupModules: readonly string[]
  readonly maximumBytes: number
}

const KIBIBYTE = 1024
const ONE_FILE_BUNDLE_BUDGET_BYTES = 16_896 * KIBIBYTE

export const MAIN_ENTRY_CHUNK = 'index.js'

export const MAIN_PROCESS_BUDGETS: readonly MainProcessBudget[] = [
  {
    label: 'desktop app (GUI)',
    startupModules: [
      'src/main/gui-runtime.ts',
      'src/main/gui-desktop-services.ts',
      'src/main/ipc/handlers.ts',
      'src/main/ipc/agent-handler.ts',
      'src/main/ipc/startup-handler.ts',
      'src/main/store/settings.ts',
      'src/main/usage-statistics/usage-statistics-gui.ts',
    ],
    maximumBytes: ONE_FILE_BUNDLE_BUDGET_BYTES,
  },
  {
    label: 'Session Host',
    startupModules: [
      'src/main/session-host/session-host-ownership.ts',
      'src/main/session-host/session-host-cutover.ts',
      'src/main/runtime.ts',
      'src/main/store/settings.ts',
      'src/main/session-host/session-host-bootstrap.ts',
    ],
    maximumBytes: ONE_FILE_BUNDLE_BUDGET_BYTES,
  },
  {
    label: 'openwaggle hive',
    startupModules: ['src/main/sessions-cli.ts'],
    maximumBytes: ONE_FILE_BUNDLE_BUDGET_BYTES,
  },
  {
    label: 'openwaggle run',
    startupModules: ['src/main/run-cli.ts'],
    maximumBytes: ONE_FILE_BUNDLE_BUDGET_BYTES,
  },
  {
    label: 'openwaggle mcp',
    startupModules: ['src/main/mcp-cli.ts'],
    maximumBytes: ONE_FILE_BUNDLE_BUDGET_BYTES,
  },
]

function isMainChunkManifestEntry(value: unknown): value is MainChunkManifestEntry {
  if (typeof value !== 'object' || value === null) return false
  const stringArray = (key: string) => {
    const field: unknown = Reflect.get(value, key)
    return Array.isArray(field) && field.every((item) => typeof item === 'string')
  }
  return (
    typeof Reflect.get(value, 'file') === 'string' &&
    typeof Reflect.get(value, 'isEntry') === 'boolean' &&
    stringArray('modules') &&
    stringArray('imports') &&
    stringArray('dynamicImports')
  )
}

export function parseMainChunkManifest(value: unknown): readonly MainChunkManifestEntry[] {
  if (!Array.isArray(value)) throw new Error('The main chunk manifest is not an array.')
  const entries: unknown[] = value
  return entries.map((entry, index) => {
    if (!isMainChunkManifestEntry(entry)) {
      throw new Error(`Malformed main chunk manifest entry ${String(index)}.`)
    }
    return entry
  })
}

/** The chunks a process loads to reach its startup modules, as files beside `index.js`. */
export function processStartupChunks(
  manifest: readonly MainChunkManifestEntry[],
  startupModules: readonly string[],
) {
  const byFile = new Map(manifest.map((entry) => [entry.file, entry]))
  if (!byFile.has(MAIN_ENTRY_CHUNK)) throw new Error(`The main build emitted no ${MAIN_ENTRY_CHUNK}.`)
  const roots = [MAIN_ENTRY_CHUNK]
  for (const module of startupModules) {
    const holder = manifest.find((entry) => entry.modules.includes(module))
    if (!holder) throw new Error(`No main chunk holds ${module}; update MAIN_PROCESS_BUDGETS.`)
    roots.push(holder.file)
  }
  const visited = new Set<string>()
  const pending = [...roots]
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)
    for (const imported of byFile.get(file)?.imports ?? []) {
      if (byFile.has(imported)) pending.push(imported)
    }
  }
  return [...visited].sort()
}
