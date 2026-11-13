/**
 * The files that hold Electron `safeStorage` blobs, and how each is re-sealed in place:
 * - `<userData>/mcp/vault.json`: `{ version: 1, secrets: { <name>: { encryptedValue, ... } } }`;
 * - `<userData>/mcp/oauth-states.json`: `{ version: 1, encrypted }`;
 * - `<userData>/session-host/profile-credentials/*.credential`: the raw blob;
 * - `~/.openwaggle/mcp/{vault,oauth-states}.json`, which every build shared before ADR 0032: never
 *   changed, but taken over into user data when this install has no file of its own yet, exactly
 *   as the Electron build does on its first save.
 * Every rewrite is atomic and keeps the original once under `electron-migration-backup/`.
 */
import { randomUUID } from 'node:crypto'
import { constants as FS_CONSTANTS } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '../../shared/schema'
import { SafeStorageDecryptError } from './electron-safe-storage'
import { isSealedBlob } from './keychain-sealer'

const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700
const JSON_INDENT = 2
const CURRENT_FILE_VERSION = 1
export const MIGRATION_BACKUP_DIRECTORY = 'electron-migration-backup'

export interface SecretCodec {
  /** Opens an Electron blob; throws `SafeStorageDecryptError`. */
  readonly decryptLegacy: (blob: Buffer) => Promise<string>
  readonly seal: (plaintext: string) => Promise<Buffer>
}

export interface SecretFileLocations {
  readonly userData: string
  /** `~/.openwaggle/mcp`, the pre-ADR-0032 shared MCP state. */
  readonly sharedMcpDirectory: string
}

export interface SecretFileResult {
  /** Relative to user data. */
  readonly file: string
  readonly resealed: number
  readonly alreadySealed: number
  /** Entries no key from the previous install opens: left untouched, to be entered again. */
  readonly unrecoverable: readonly string[]
  readonly takenOverFrom?: string
}

function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readOptional(filePath: string) {
  try {
    return await readFile(filePath)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

const vaultEntrySchema = Schema.Struct({
  encryptedValue: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
type VaultEntry = typeof vaultEntrySchema.Type

const vaultFileSchema = Schema.Struct({
  version: Schema.Literal(CURRENT_FILE_VERSION),
  secrets: Schema.Record({ key: Schema.String, value: vaultEntrySchema }),
})

const oauthFileSchema = Schema.Struct({
  version: Schema.Literal(CURRENT_FILE_VERSION),
  encrypted: Schema.String,
})

/** A user-data-relative path with `/` on every OS, for the migration state and the UI. */
function reportedPath(userData: string, target: string) {
  return path.relative(userData, target).split(path.sep).join('/')
}

async function backUpOnce(userData: string, filePath: string) {
  const relative = path.relative(userData, filePath)
  const backup = path.join(userData, MIGRATION_BACKUP_DIRECTORY, relative)
  await mkdir(path.dirname(backup), { recursive: true, mode: DIRECTORY_MODE })
  try {
    await copyFile(filePath, backup, FS_CONSTANTS.COPYFILE_EXCL)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
}

async function writeAtomically(filePath: string, contents: string | Buffer) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: DIRECTORY_MODE })
  const temporary = `${filePath}.electron-migration-${randomUUID()}`
  try {
    await writeFile(temporary, contents, { mode: FILE_MODE })
    await rename(temporary, filePath)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** A blob that a wrong or missing key cannot open is reported; key outages abort the whole step. */
async function reseal(codec: SecretCodec, blob: Buffer) {
  if (isSealedBlob(blob)) return { kind: 'sealed' as const }
  try {
    return { kind: 'resealed' as const, blob: await codec.seal(await codec.decryptLegacy(blob)) }
  } catch (error) {
    if (error instanceof SafeStorageDecryptError && error.reason !== 'key-unavailable') {
      return { kind: 'unrecoverable' as const }
    }
    throw error
  }
}

function decodeFile<A, I>(schema: Schema.Schema<A, I>, raw: Buffer, file: string) {
  const decoded = safeDecodeUnknown(schema, parseJsonUnknown(raw.toString('utf8')))
  if (!decoded.success) throw new Error(`${file} has an unsupported format.`)
  return decoded.data
}

async function resealVaultEntries(
  codec: SecretCodec,
  entries: Readonly<Record<string, VaultEntry>>,
  takeover: boolean,
) {
  const secrets: Record<string, VaultEntry> = {}
  let resealed = 0
  let alreadySealed = 0
  const unrecoverable: string[] = []
  for (const [name, entry] of Object.entries(entries)) {
    const result = await reseal(codec, Buffer.from(entry.encryptedValue, 'base64'))
    if (result.kind === 'unrecoverable') {
      unrecoverable.push(name)
      // A takeover copies only what this install can open, as the Electron build's first save does.
      if (!takeover) secrets[name] = entry
      continue
    }
    if (result.kind === 'sealed') {
      alreadySealed += 1
      secrets[name] = entry
      continue
    }
    resealed += 1
    secrets[name] = { ...entry, encryptedValue: result.blob.toString('base64') }
  }
  return { secrets, resealed, alreadySealed, unrecoverable }
}

async function migrateVaultFile(
  codec: SecretCodec,
  locations: SecretFileLocations,
  ownPath: string,
  sharedPath: string,
) {
  const file = reportedPath(locations.userData, ownPath)
  const own = await readOptional(ownPath)
  const source = own ?? (await readOptional(sharedPath))
  if (!source) return undefined
  const vault = decodeFile(vaultFileSchema, source, file)
  const { secrets, resealed, alreadySealed, unrecoverable } = await resealVaultEntries(
    codec,
    vault.secrets,
    own === undefined,
  )
  if (own && resealed === 0) return { file, resealed, alreadySealed, unrecoverable }
  if (own) await backUpOnce(locations.userData, ownPath)
  await writeAtomically(ownPath, `${JSON.stringify({ ...vault, secrets }, null, JSON_INDENT)}\n`)
  return {
    file,
    resealed,
    alreadySealed,
    unrecoverable,
    ...(own ? {} : { takenOverFrom: sharedPath }),
  }
}

async function migrateOAuthFile(
  codec: SecretCodec,
  locations: SecretFileLocations,
  ownPath: string,
  sharedPath: string,
) {
  const file = reportedPath(locations.userData, ownPath)
  const own = await readOptional(ownPath)
  const source = own ?? (await readOptional(sharedPath))
  if (!source) return undefined
  const store = decodeFile(oauthFileSchema, source, file)
  const result = await reseal(codec, Buffer.from(store.encrypted, 'base64'))
  const base = { file, resealed: 0, alreadySealed: 0, unrecoverable: [] }
  if (result.kind === 'sealed') return { ...base, alreadySealed: 1 }
  if (result.kind === 'unrecoverable') return { ...base, unrecoverable: ['oauth-states'] }
  if (own) await backUpOnce(locations.userData, ownPath)
  await writeAtomically(
    ownPath,
    `${JSON.stringify({ ...store, encrypted: result.blob.toString('base64') }, null, JSON_INDENT)}\n`,
  )
  return { ...base, resealed: 1, ...(own ? {} : { takenOverFrom: sharedPath }) }
}

async function migrateProfileCredentials(codec: SecretCodec, locations: SecretFileLocations) {
  const directory = path.join(locations.userData, 'session-host', 'profile-credentials')
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  let resealed = 0
  let alreadySealed = 0
  const unrecoverable: string[] = []
  for (const name of names.filter((candidate) => candidate.endsWith('.credential')).sort()) {
    const filePath = path.join(directory, name)
    const blob = await readOptional(filePath)
    if (!blob) continue
    const result = await reseal(codec, blob)
    if (result.kind === 'sealed') alreadySealed += 1
    if (result.kind === 'unrecoverable') unrecoverable.push(name)
    if (result.kind !== 'resealed') continue
    await backUpOnce(locations.userData, filePath)
    await writeAtomically(filePath, result.blob)
    resealed += 1
  }
  return {
    file: reportedPath(locations.userData, directory),
    resealed,
    alreadySealed,
    unrecoverable,
  }
}

/**
 * Re-seals every known secret file. Idempotent: a sealed blob is skipped by its prefix, so a run
 * interrupted between files resumes where it stopped. Throws when the previous install's key is
 * unavailable (a refused keychain prompt, a locked keyring), leaving the remaining files as they were.
 */
export async function migrateSecretFiles(codec: SecretCodec, locations: SecretFileLocations) {
  const mcp = path.join(locations.userData, 'mcp')
  const results: (SecretFileResult | undefined)[] = [
    await migrateVaultFile(
      codec,
      locations,
      path.join(mcp, 'vault.json'),
      path.join(locations.sharedMcpDirectory, 'vault.json'),
    ),
    await migrateOAuthFile(
      codec,
      locations,
      path.join(mcp, 'oauth-states.json'),
      path.join(locations.sharedMcpDirectory, 'oauth-states.json'),
    ),
    await migrateProfileCredentials(codec, locations),
  ]
  return results.filter((result): result is SecretFileResult => result !== undefined)
}
