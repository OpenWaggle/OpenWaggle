import {
  applyElectronLocalStorageImport,
  electronLocalStorageImportFromArguments,
} from '@shared/utils/electron-local-storage-import'

/**
 * Applies the Electron build's exported `localStorage` before any renderer module reads it, then
 * tells main. A window without the argument, or without storage, does nothing; main passes the
 * import again on the next launch until it is acknowledged.
 */
export function applyPendingElectronLocalStorageImport(
  argv: readonly string[],
  acknowledge: (importId: string) => void,
) {
  const payload = electronLocalStorageImportFromArguments(argv)
  if (!payload) return
  try {
    acknowledge(applyElectronLocalStorageImport(globalThis.localStorage, payload).importId)
  } catch {
    // localStorage refused the marker write itself; the next launch tries again.
  }
}
