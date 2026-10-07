import { mkdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { parseJsonUnknown } from '@shared/schema'
import type { JsonObject, JsonValue } from '@shared/types/json'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import { renameLegacyProviderCredentials } from './pi-provider-renames'

const logger = createLogger('pi-legacy-provider-credentials')

const AUTH_FILE_NAME = 'auth.json'
const OWNER_ONLY_FILE_MODE = 0o600
const LOCK_ATTEMPTS = 20
const LOCK_RETRY_MS = 50
/** proper-lockfile's default stale age, which Pi's auth storage uses for the same lock. */
const STALE_LOCK_MS = 10_000
const JSON_INDENT_SPACES = 2

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrorWithCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Takes Pi's `auth.json` lock: the same `<file>.lock` directory proper-lockfile creates. */
async function acquireAuthLock(lockPath: string) {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockPath)
      return true
    } catch (error) {
      if (!isErrorWithCode(error, 'EEXIST')) throw error
      const lockStat = await stat(lockPath).catch(() => undefined)
      if (lockStat && Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
        await rmdir(lockPath).catch(() => undefined)
        continue
      }
      await sleep(LOCK_RETRY_MS)
    }
  }
  return false
}

async function readCredentials(authPath: string): Promise<JsonObject | undefined> {
  let content: string
  try {
    content = await readFile(authPath, 'utf8')
  } catch (error) {
    if (isErrorWithCode(error, 'ENOENT')) return undefined
    throw error
  }
  if (content.trim().length === 0) return undefined
  const parsed: unknown = parseJsonUnknown(content)
  if (!isJsonObject(parsed)) {
    logger.warn('Leaving Pi credentials that are not a JSON object unchanged')
    return undefined
  }
  return parsed
}

async function writeCredentials(authPath: string, credentials: Record<string, JsonValue>) {
  const temporaryPath = `${authPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, JSON.stringify(credentials, null, JSON_INDENT_SPACES), {
    mode: OWNER_ONLY_FILE_MODE,
  })
  await rename(temporaryPath, authPath)
}

/**
 * Copies each credential stored under a provider id Pi renamed to the new id in Pi's `auth.json`
 * (Pi 1.0.3 renamed `azure-openai-responses` to `azure` without migrating it), so an Azure login
 * keeps working. The old entry stays for a standalone Pi older than the rename. Returns whether
 * the file changed. Safe to run on every Host start: a copied credential is never copied again.
 */
export async function migrateLegacyProviderCredentials(
  authPath = join(getAgentDir(), AUTH_FILE_NAME),
): Promise<boolean> {
  const current = await readCredentials(authPath)
  if (!current || renameLegacyProviderCredentials(current) === current) return false
  const lockPath = `${authPath}.lock`
  if (!(await acquireAuthLock(lockPath))) {
    logger.warn('Pi credentials are locked; the provider rename will retry at the next Host start')
    return false
  }
  try {
    const locked = await readCredentials(authPath)
    if (!locked) return false
    const renamed = renameLegacyProviderCredentials(locked)
    if (renamed === locked) return false
    await writeCredentials(authPath, renamed)
    logger.info('Copied stored credentials to renamed Pi providers')
    return true
  } finally {
    await rmdir(lockPath).catch(() => undefined)
  }
}

/** The Host-start form of {@link migrateLegacyProviderCredentials}: a failure is logged, never fatal. */
export const migrateLegacyProviderCredentialsOnHostStart = Effect.tryPromise(() =>
  migrateLegacyProviderCredentials(),
).pipe(
  Effect.asVoid,
  Effect.catchAll((error) =>
    Effect.sync(() => {
      logger.warn(
        'Legacy provider credential migration failed; it will retry at the next Host start',
        {
          error: error.cause instanceof Error ? error.cause.message : String(error.cause),
        },
      )
    }),
  ),
)
