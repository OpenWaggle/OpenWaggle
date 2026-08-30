import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, link, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const CREDENTIAL_BYTES = 32
const BASE64URL_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/
const OWNER_FILE_MODE = 0o600

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
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }

  const credential = randomBytes(CREDENTIAL_BYTES).toString('base64url')
  const temporaryPath = path.join(
    path.dirname(credentialPath),
    `.${path.basename(credentialPath)}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(temporaryPath, `${credential}\n`, {
      encoding: 'utf8',
      mode: OWNER_FILE_MODE,
      flag: 'wx',
    })
    try {
      await link(temporaryPath, credentialPath)
      await chmod(credentialPath, OWNER_FILE_MODE)
      return credential
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      const installed = await readFile(credentialPath, 'utf8')
      decodeCredential(installed)
      await chmod(credentialPath, OWNER_FILE_MODE)
      return installed.trim()
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}
