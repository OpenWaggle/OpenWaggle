import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { preparedAttachmentSchema } from '@shared/schemas/validation'
import type { PreparedAttachment } from '@shared/types/agent'
import { isEnoent } from '@shared/utils/node-error'

interface PreparedAttachmentCapability {
  readonly attachment: PreparedAttachment
  readonly realPath: string
  readonly savedAt: number
}

const REGISTRY_FILE_NAME = 'prepared-attachment-capabilities.json'
const REGISTRY_FILE_VERSION = 1
const MAX_PERSISTED_CAPABILITIES = 256
const REGISTRY_FILE_MODE = 0o600

const capabilitySchema = Schema.Struct({
  attachment: preparedAttachmentSchema,
  realPath: Schema.String,
  savedAt: Schema.Number,
})

const registrySchema = Schema.Struct({
  version: Schema.Literal(REGISTRY_FILE_VERSION),
  capabilities: Schema.mutable(Schema.Array(capabilitySchema)),
})

const preparedAttachments = new Map<string, PreparedAttachmentCapability>()
let registryFilePath: string | null = null
let loadPromise: Promise<void> | null = null
let writeQueue: Promise<void> = Promise.resolve()

function normalizeCapabilityPath(filePath: string) {
  return path.normalize(filePath)
}

function compactAttachment(attachment: PreparedAttachment): PreparedAttachment {
  return { ...attachment, extractedText: '' }
}

function sameOptionalValue(left: string | undefined, right: string | undefined) {
  return (left ?? null) === (right ?? null)
}

async function loadRegistry(filePath: string) {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (isEnoent(error)) return
    throw error
  }

  const decoded = safeDecodeUnknown(registrySchema, JSON.parse(raw))
  if (!decoded.success) {
    throw new Error('The prepared attachment capability registry is invalid.')
  }

  for (const capability of decoded.data.capabilities) {
    preparedAttachments.set(capability.attachment.id, {
      attachment: capability.attachment,
      realPath: normalizeCapabilityPath(capability.realPath),
      savedAt: capability.savedAt,
    })
  }
}

function ensureRegistryLoaded() {
  if (!registryFilePath) {
    return Promise.reject(new Error('The prepared attachment registry is not configured.'))
  }
  loadPromise ??= loadRegistry(registryFilePath)
  return loadPromise
}

async function writeRegistry(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  const capabilities = [...preparedAttachments.values()]
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, MAX_PERSISTED_CAPABILITIES)
    .map((capability) => ({
      ...capability,
      attachment: compactAttachment(capability.attachment),
    }))

  try {
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify({ version: REGISTRY_FILE_VERSION, capabilities })}\n`,
      { encoding: 'utf8', mode: REGISTRY_FILE_MODE },
    )
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function persistRegistry() {
  const filePath = registryFilePath
  if (!filePath) {
    return Promise.reject(new Error('The prepared attachment registry is not configured.'))
  }
  writeQueue = writeQueue.then(() => writeRegistry(filePath))
  return writeQueue
}

export function configurePreparedAttachmentRegistry(userDataPath: string): void {
  const nextFilePath = path.join(userDataPath, REGISTRY_FILE_NAME)
  if (registryFilePath === nextFilePath) return
  preparedAttachments.clear()
  registryFilePath = nextFilePath
  loadPromise = null
  writeQueue = Promise.resolve()
}

export async function rememberPreparedAttachment(
  attachment: PreparedAttachment,
  realPath: string,
): Promise<void> {
  await ensureRegistryLoaded()
  const normalizedRealPath = normalizeCapabilityPath(await fs.realpath(realPath))
  preparedAttachments.set(attachment.id, {
    attachment: { ...attachment, path: normalizedRealPath },
    realPath: normalizedRealPath,
    savedAt: Date.now(),
  })
  await persistRegistry()
}

export async function resolvePreparedAttachmentCapability(
  attachment: PreparedAttachment,
): Promise<PreparedAttachment> {
  await ensureRegistryLoaded()
  const capability = preparedAttachments.get(attachment.id)
  if (!capability) {
    throw new Error(`Attachment was not prepared by this app: ${attachment.name}`)
  }

  const requestedPath = normalizeCapabilityPath(await fs.realpath(attachment.path))
  if (requestedPath !== capability.realPath) {
    throw new Error(`Attachment path does not match prepared file: ${attachment.name}`)
  }

  const prepared = capability.attachment
  if (
    prepared.kind !== attachment.kind ||
    prepared.name !== attachment.name ||
    prepared.mimeType !== attachment.mimeType ||
    prepared.sizeBytes !== attachment.sizeBytes ||
    !sameOptionalValue(prepared.contentSha256, attachment.contentSha256) ||
    !sameOptionalValue(prepared.origin, attachment.origin)
  ) {
    throw new Error(`Attachment metadata does not match prepared file: ${attachment.name}`)
  }

  return prepared
}

export function resetPreparedAttachmentRegistryForTests(): void {
  preparedAttachments.clear()
  registryFilePath = null
  loadPromise = null
  writeQueue = Promise.resolve()
}
