import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, link, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const CREDENTIAL_BYTES = 32
const BASE64URL_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/
const OWNER_FILE_MODE = 0o600

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

async function removeTemporaryCredential(
  temporaryPath: string,
  operationError: unknown | undefined,
) {
  try {
    await unlink(temporaryPath)
  } catch (cleanupError) {
    if (hasErrorCode(cleanupError, 'ENOENT')) return
    if (operationError !== undefined) {
      throw new AggregateError(
        [operationError, cleanupError],
        'Local Session credential installation and temporary-file cleanup both failed.',
        { cause: cleanupError },
      )
    }
    throw cleanupError
  }
}

function decodeCredential(value: string): Buffer {
  const trimmed = value.trim()
  if (!BASE64URL_CREDENTIAL_PATTERN.test(trimmed)) {
    throw new Error('Local Session credential has an invalid encoding.')
  }
  const decoded = Buffer.from(trimmed, 'base64url')
  if (decoded.byteLength !== CREDENTIAL_BYTES) {
    throw new Error('Local Session credential has an invalid length.')
  }
  return decoded
}

export function credentialsMatch(expected: string, received: string): boolean {
  try {
    return timingSafeEqual(decodeCredential(expected), decodeCredential(received))
  } catch {
    return false
  }
}

export async function ensureLocalUserCredential(credentialPath: string): Promise<string> {
  try {
    const existing = await readFile(credentialPath, 'utf8')
    decodeCredential(existing)
    await chmod(credentialPath, OWNER_FILE_MODE)
    return existing.trim()
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }

  const credential = randomBytes(CREDENTIAL_BYTES).toString('base64url')
  const temporaryPath = path.join(
    path.dirname(credentialPath),
    `.${path.basename(credentialPath)}.${randomUUID()}.tmp`,
  )
  let ownsTemporaryPath = false
  let operationError: unknown | undefined
  try {
    await writeFile(temporaryPath, `${credential}\n`, {
      encoding: 'utf8',
      mode: OWNER_FILE_MODE,
      flag: 'wx',
    })
    ownsTemporaryPath = true
    try {
      await link(temporaryPath, credentialPath)
      await chmod(credentialPath, OWNER_FILE_MODE)
      return credential
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
      const installed = await readFile(credentialPath, 'utf8')
      decodeCredential(installed)
      await chmod(credentialPath, OWNER_FILE_MODE)
      return installed.trim()
    }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    if (ownsTemporaryPath) await removeTemporaryCredential(temporaryPath, operationError)
  }
}
