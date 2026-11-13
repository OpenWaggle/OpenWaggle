import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseJsonUnknown, safeDecodeUnknown, Schema } from '@shared/schema'
import {
  CEF_COMPONENT_SCHEMA_VERSION,
  CefComponentArchSchema,
  CefSha256Schema,
  CefVersionSchema,
  type CefComponentTarget,
} from './cef-component-manifest'

/** The record an install writes last into its staging directory, before the final rename. */
export const CEF_COMPONENT_RECORD = 'component.json'
export const CEF_FRAMEWORK_BINARY = path.join(
  'Chromium Embedded Framework.framework',
  'Chromium Embedded Framework',
)
const CEF_HELPER_BINARY = path.join('bun Helper.app', 'Contents', 'MacOS', 'bun Helper')

const CefComponentRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(CEF_COMPONENT_SCHEMA_VERSION),
  cefVersion: CefVersionSchema,
  arch: CefComponentArchSchema,
  sha256: CefSha256Schema,
})

/** The install root's name inside `<appData>/<identifier>/cef`. */
export function cefComponentDirectoryName(target: Pick<CefComponentTarget, 'cefVersion' | 'arch'>) {
  return `${target.cefVersion}-${target.arch}`
}

export function cefComponentRecord(target: CefComponentTarget) {
  return {
    schemaVersion: CEF_COMPONENT_SCHEMA_VERSION,
    cefVersion: target.cefVersion,
    arch: target.arch,
    sha256: target.asset.sha256,
  } satisfies typeof CefComponentRecordSchema.Type
}

async function isPresent(file: string, mode: number) {
  try {
    await fs.access(file, mode)
    return true
  } catch {
    return false
  }
}

/** The first file CEF needs that `directory` lacks, or `null` when it has them all. */
export async function missingCefComponentFile(directory: string) {
  if (!(await isPresent(path.join(directory, CEF_FRAMEWORK_BINARY), constants.R_OK))) {
    return CEF_FRAMEWORK_BINARY
  }
  if (!(await isPresent(path.join(directory, CEF_HELPER_BINARY), constants.X_OK))) {
    return CEF_HELPER_BINARY
  }
  return null
}

async function readRecord(root: string) {
  try {
    const raw = await fs.readFile(path.join(root, CEF_COMPONENT_RECORD), 'utf8')
    const decoded = safeDecodeUnknown(CefComponentRecordSchema, parseJsonUnknown(raw))
    return decoded.success ? decoded.data : null
  } catch {
    return null
  }
}

/** The installed component is the pinned one: its record matches and CEF's files are there. */
export async function isCefComponentCurrent(root: string, target: CefComponentTarget) {
  const record = await readRecord(root)
  if (
    record?.cefVersion !== target.cefVersion ||
    record.arch !== target.arch ||
    record.sha256 !== target.asset.sha256
  ) {
    return false
  }
  return (await missingCefComponentFile(root)) === null
}

/** Removes every entry of `componentsDirectory` but `keep`: other versions and leftover temps. */
export async function pruneCefComponents(componentsDirectory: string, keep: string) {
  const entries = await fs.readdir(componentsDirectory).catch(() => [])
  await Promise.all(
    entries
      .filter((entry) => entry !== keep)
      .map((entry) =>
        fs.rm(path.join(componentsDirectory, entry), { recursive: true, force: true }),
      ),
  )
}
