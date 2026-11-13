/**
 * Applies the renderer `localStorage` exported from the Electron build (ADR 0064) in the new
 * shell's webview, before any renderer module reads it. Keys the new renderer already has win, so a
 * repeated or late import never undoes a change made after the move; a marker records the import so
 * a second boot with the same payload does nothing.
 */
export const ELECTRON_LOCAL_STORAGE_IMPORT_MARKER = 'openwaggle:electron-local-storage-import'

export interface ImportableStorage {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
}

export interface ElectronLocalStorageImport {
  readonly importId: string
  readonly entries: Readonly<Record<string, string>>
}

interface ElectronLocalStorageImportResult {
  readonly importId: string
  readonly applied: number
  /** Present in the new storage already, so left as they were. */
  readonly kept: number
  /** Could not be written, for example over the storage quota. */
  readonly failed: number
  readonly alreadyApplied: boolean
}

export function applyElectronLocalStorageImport(
  storage: ImportableStorage,
  payload: ElectronLocalStorageImport,
) {
  const base = { importId: payload.importId, applied: 0, kept: 0, failed: 0 }
  if (storage.getItem(ELECTRON_LOCAL_STORAGE_IMPORT_MARKER) === payload.importId) {
    const result: ElectronLocalStorageImportResult = { ...base, alreadyApplied: true }
    return result
  }
  let applied = 0
  let kept = 0
  let failed = 0
  for (const [key, value] of Object.entries(payload.entries)) {
    if (key === ELECTRON_LOCAL_STORAGE_IMPORT_MARKER) continue
    if (storage.getItem(key) !== null) {
      kept += 1
      continue
    }
    try {
      storage.setItem(key, value)
      applied += 1
    } catch {
      // QuotaExceededError: the rest may still fit; the count reaches the acknowledgement.
      failed += 1
    }
  }
  storage.setItem(ELECTRON_LOCAL_STORAGE_IMPORT_MARKER, payload.importId)
  const result: ElectronLocalStorageImportResult = {
    importId: payload.importId,
    applied,
    kept,
    failed,
    alreadyApplied: false,
  }
  return result
}

/** The renderer argument that carries a pending import to the first window's preload. */
const LOCAL_STORAGE_IMPORT_SWITCH = '--openwaggle-electron-local-storage-import='

export function electronLocalStorageImportRendererArguments(
  payload: ElectronLocalStorageImport | null,
) {
  return payload ? [`${LOCAL_STORAGE_IMPORT_SWITCH}${JSON.stringify(payload)}`] : []
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

/** The pending import main passed in the renderer arguments, or null. */
export function electronLocalStorageImportFromArguments(argv: readonly string[]) {
  const argument = argv.find((entry) => entry.startsWith(LOCAL_STORAGE_IMPORT_SWITCH))
  if (argument === undefined) return null
  try {
    const parsed: unknown = JSON.parse(argument.slice(LOCAL_STORAGE_IMPORT_SWITCH.length))
    if (typeof parsed !== 'object' || parsed === null) return null
    const importId: unknown = Reflect.get(parsed, 'importId')
    const entries: unknown = Reflect.get(parsed, 'entries')
    if (typeof importId !== 'string' || !isStringRecord(entries)) return null
    return { importId, entries }
  } catch {
    return null
  }
}
