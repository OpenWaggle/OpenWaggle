/**
 * `electron-local-storage.json`: the renderer `localStorage` exported from Electron's LevelDB,
 * kept under userData until the new renderer has applied it, so a launch that dies before the
 * first window loads hands over the same snapshot next time.
 */
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '../../shared/schema'

export const LOCAL_STORAGE_EXPORT_FILE = 'electron-local-storage.json'
const EXPORT_VERSION = 1
const FILE_MODE = 0o600

export interface LocalStorageExport {
  readonly importId: string
  readonly entries: Readonly<Record<string, string>>
}

const exportFileSchema = Schema.Struct({
  version: Schema.Literal(EXPORT_VERSION),
  importId: Schema.String,
  entries: Schema.Record({ key: Schema.String, value: Schema.String }),
})

export async function writeLocalStorageExport(userData: string, exported: LocalStorageExport) {
  const target = path.join(userData, LOCAL_STORAGE_EXPORT_FILE)
  const temporary = `${target}.${randomUUID()}`
  const body = { version: EXPORT_VERSION, importId: exported.importId, entries: exported.entries }
  try {
    await writeFile(temporary, JSON.stringify(body), { mode: FILE_MODE })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function readLocalStorageExport(userData: string) {
  let raw: string
  try {
    raw = await readFile(path.join(userData, LOCAL_STORAGE_EXPORT_FILE), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  const decoded = safeDecodeUnknown(exportFileSchema, parseJsonUnknown(raw))
  if (!decoded.success) throw new Error(`${LOCAL_STORAGE_EXPORT_FILE} has an unsupported format.`)
  const exported: LocalStorageExport = {
    importId: decoded.data.importId,
    entries: decoded.data.entries,
  }
  return exported
}

export function removeLocalStorageExport(userData: string) {
  return rm(path.join(userData, LOCAL_STORAGE_EXPORT_FILE), { force: true })
}
