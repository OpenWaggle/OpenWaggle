/**
 * `electron-local-storage.json`: the renderer `localStorage` exported from Electron's LevelDB,
 * kept under userData until the new renderer has applied it, so a launch that dies before the
 * first window loads hands over the same snapshot next time.
 */
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const LOCAL_STORAGE_EXPORT_FILE = 'electron-local-storage.json'
const EXPORT_VERSION = 1
const FILE_MODE = 0o600

export interface LocalStorageExport {
  readonly importId: string
  readonly entries: Readonly<Record<string, string>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

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

export async function readLocalStorageExport(
  userData: string,
): Promise<LocalStorageExport | undefined> {
  let raw: string
  try {
    raw = await readFile(path.join(userData, LOCAL_STORAGE_EXPORT_FILE), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  const parsed: unknown = JSON.parse(raw)
  if (
    !isRecord(parsed) ||
    parsed['version'] !== EXPORT_VERSION ||
    typeof parsed['importId'] !== 'string' ||
    !isStringRecord(parsed['entries'])
  ) {
    throw new Error(`${LOCAL_STORAGE_EXPORT_FILE} has an unsupported format.`)
  }
  return { importId: parsed['importId'], entries: parsed['entries'] }
}

export function removeLocalStorageExport(userData: string) {
  return rm(path.join(userData, LOCAL_STORAGE_EXPORT_FILE), { force: true })
}
