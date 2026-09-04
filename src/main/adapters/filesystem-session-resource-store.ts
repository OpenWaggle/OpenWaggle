import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isEnoent } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { app } from 'electron'
import { SessionResourceStoreError } from '../errors'
import {
  SessionResourceStore,
  type SessionResourceStoreShape,
  type StoreSessionResourceBytesInput,
} from '../ports/session-resource-store'

const RESOURCE_DIRECTORY = 'session-resources'
const MAX_DIRECTORY_ENTRY_BYTES = 255
const MAX_RESOURCE_ID_BYTES = 64
const MAX_EXTENSION_BYTES = 32
const TEMPORARY_SUFFIX = '.tmp'
const SHA256_PATTERN = /^[a-f0-9]{64}$/u

function storeError(operation: string, cause: unknown) {
  return new SessionResourceStoreError({ operation, cause })
}

function safeFileName(fileName: string) {
  const normalized = path.basename(fileName).replaceAll(/[^a-zA-Z0-9._-]/g, '-')
  return normalized.length > 0 ? normalized : 'resource'
}

function truncateUtf8(value: string, maxBytes: number) {
  if (Buffer.byteLength(value) <= maxBytes) return value
  let byteLength = 0
  let result = ''
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character)
    if (byteLength + characterBytes > maxBytes) break
    byteLength += characterBytes
    result += character
  }
  return result
}

function truncateFileName(fileName: string, maxBytes: number) {
  if (Buffer.byteLength(fileName) <= maxBytes) return fileName
  const candidateExtension = path.extname(fileName)
  const extension =
    Buffer.byteLength(candidateExtension) <= MAX_EXTENSION_BYTES ? candidateExtension : ''
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  return `${truncateUtf8(stem, maxBytes - Buffer.byteLength(extension))}${extension}`
}

function managedFileName(resourceId: string, fileName: string) {
  const safeResourceId = truncateUtf8(safeFileName(resourceId), MAX_RESOURCE_ID_BYTES)
  const prefix = `${safeResourceId}-`
  const availableNameBytes =
    MAX_DIRECTORY_ENTRY_BYTES - Buffer.byteLength(prefix) - Buffer.byteLength(TEMPORARY_SUFFIX)
  return `${prefix}${truncateFileName(safeFileName(fileName), availableNameBytes)}`
}

async function temporaryPathFor(targetPath: string) {
  await fs.rm(`${targetPath}${TEMPORARY_SUFFIX}`, { force: true })
  return path.join(path.dirname(targetPath), `.${randomUUID()}${TEMPORARY_SUFFIX}`)
}

function isWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..'
}

async function inspectManagedPath(root: string, managedPath: string) {
  const [realRoot, realPath] = await Promise.all([fs.realpath(root), fs.realpath(managedPath)])
  if (!isWithinRoot(realRoot, realPath)) {
    throw new Error('Session resource path escapes the managed resource directory.')
  }
  const handle = await fs.open(realPath, 'r')
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error('Session resource path is not a regular file.')
    }
  } finally {
    await handle.close()
  }
  return realPath
}

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sessionDirectoryName(sessionId: string) {
  return createHash('sha256').update(sessionId).digest('hex')
}

async function sessionDirectoryFor(root: string, sessionId: string) {
  await fs.mkdir(root, { recursive: true })
  const realRoot = await fs.realpath(root)
  const target = path.join(realRoot, sessionDirectoryName(sessionId))
  await fs.mkdir(target).catch(async (cause: NodeJS.ErrnoException) => {
    if (cause.code !== 'EEXIST') throw cause
    const stats = await fs.lstat(target)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('Session resource directory is not a managed directory.')
    }
  })
  const realTarget = await fs.realpath(target)
  if (!isWithinRoot(realRoot, realTarget)) {
    throw new Error('Session resource directory escapes the managed resource root.')
  }
  return realTarget
}

function validateFileCopyLimits(input: {
  readonly expectedSizeBytes: number
  readonly expectedSha256?: string
  readonly maxSizeBytes: number
}) {
  if (
    !Number.isSafeInteger(input.expectedSizeBytes) ||
    input.expectedSizeBytes < 0 ||
    !Number.isSafeInteger(input.maxSizeBytes) ||
    input.maxSizeBytes <= 0 ||
    input.expectedSizeBytes > input.maxSizeBytes ||
    (input.expectedSha256 !== undefined && !SHA256_PATTERN.test(input.expectedSha256))
  ) {
    throw new Error('Session resource file copy limits are invalid.')
  }
}

async function writeChunk(handle: fs.FileHandle, chunk: Buffer) {
  let offset = 0
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null)
    if (bytesWritten <= 0) throw new Error('Session resource file copy made no progress.')
    offset += bytesWritten
  }
}

async function writeBytesAtomically(temporaryPath: string, targetPath: string, bytes: Uint8Array) {
  let handle: fs.FileHandle | null = null
  let ownsTemporary = false
  try {
    handle = await fs.open(temporaryPath, 'wx')
    ownsTemporary = true
    await handle.writeFile(bytes)
    await handle.close()
    handle = null
    await fs.rename(temporaryPath, targetPath)
  } catch (cause) {
    await handle?.close().catch(() => {})
    if (ownsTemporary) await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw cause
  }
}

async function copyBoundedFile(input: {
  readonly sourcePath: string
  readonly temporaryPath: string
  readonly expectedSizeBytes: number
  readonly expectedSha256?: string
  readonly maxSizeBytes: number
}) {
  validateFileCopyLimits(input)
  const hash = createHash('sha256')
  const sourceHandle = await fs.open(input.sourcePath, 'r')
  let sizeBytes = 0
  try {
    const stats = await sourceHandle.stat()
    if (
      !stats.isFile() ||
      stats.size !== input.expectedSizeBytes ||
      stats.size > input.maxSizeBytes
    ) {
      throw new Error('Session resource source size changed before it could be copied.')
    }
    const targetHandle = await fs.open(input.temporaryPath, 'wx')
    try {
      for await (const chunk of sourceHandle.createReadStream({ autoClose: false })) {
        if (!Buffer.isBuffer(chunk)) throw new Error('Session resource source emitted text data.')
        if (
          chunk.byteLength > input.expectedSizeBytes - sizeBytes ||
          chunk.byteLength > input.maxSizeBytes - sizeBytes
        ) {
          throw new Error('Session resource source exceeds its allowed size.')
        }
        await writeChunk(targetHandle, chunk)
        hash.update(chunk)
        sizeBytes += chunk.byteLength
      }
      if (sizeBytes !== input.expectedSizeBytes) {
        throw new Error('Session resource source size changed before it could be copied.')
      }
      const sha256 = hash.digest('hex')
      if (input.expectedSha256 && sha256 !== input.expectedSha256) {
        throw new Error('Session resource source contents changed before they could be copied.')
      }
      await targetHandle.close()
      return { sha256, sizeBytes }
    } catch (cause) {
      await targetHandle.close().catch(() => {})
      await fs.rm(input.temporaryPath, { force: true }).catch(() => {})
      throw cause
    }
  } finally {
    await sourceHandle.close().catch(() => {})
  }
}

function makeStore(root: string): SessionResourceStoreShape {
  function storeBytes(input: StoreSessionResourceBytesInput) {
    return Effect.tryPromise({
      try: async () => {
        const sessionDirectory = await sessionDirectoryFor(root, String(input.sessionId))
        const target = path.join(
          sessionDirectory,
          managedFileName(input.resourceId, input.fileName),
        )
        const temporary = await temporaryPathFor(target)
        await writeBytesAtomically(temporary, target, input.bytes)
        return {
          path: target,
          sha256: digest(input.bytes),
          sizeBytes: input.bytes.byteLength,
        }
      },
      catch: (cause) => storeError('storeBytes', cause),
    })
  }

  return {
    storeBytes,
    storeFile: (input) =>
      Effect.tryPromise({
        try: async () => {
          const sessionDirectory = await sessionDirectoryFor(root, String(input.sessionId))
          const target = path.join(
            sessionDirectory,
            managedFileName(input.resourceId, input.fileName),
          )
          const temporary = await temporaryPathFor(target)
          const copied = await copyBoundedFile({
            sourcePath: input.sourcePath,
            temporaryPath: temporary,
            expectedSizeBytes: input.expectedSizeBytes,
            expectedSha256: input.expectedSha256,
            maxSizeBytes: input.maxSizeBytes,
          })
          try {
            await fs.rename(temporary, target)
          } catch (cause) {
            await fs.rm(temporary, { force: true }).catch(() => {})
            throw cause
          }
          return { path: target, ...copied }
        },
        catch: (cause) => storeError('storeFile', cause),
      }),
    inspect: (managedPath) =>
      Effect.tryPromise({
        try: async () => void (await inspectManagedPath(root, managedPath)),
        catch: (cause) => storeError('inspect', cause),
      }),
    read: (managedPath) =>
      Effect.tryPromise({
        try: async () => await fs.readFile(await inspectManagedPath(root, managedPath)),
        catch: (cause) => storeError('read', cause),
      }),
    remove: (managedPath) =>
      Effect.tryPromise({
        try: async () => {
          const resolvedRoot = path.resolve(root)
          const resolvedPath = path.resolve(managedPath)
          if (!isWithinRoot(resolvedRoot, resolvedPath)) {
            throw new Error('Session resource cleanup path escapes the managed resource directory.')
          }
          await fs.rm(resolvedPath, { force: true })
        },
        catch: (cause) => storeError('remove', cause),
      }),
    removeSession: (sessionId) =>
      Effect.tryPromise({
        try: async () => {
          const realRoot = await fs.realpath(root).catch((cause: unknown) => {
            if (isEnoent(cause)) return null
            throw cause
          })
          if (realRoot === null) return
          const target = path.join(realRoot, sessionDirectoryName(String(sessionId)))
          if (!isWithinRoot(realRoot, target)) {
            throw new Error('Session resource cleanup target is invalid.')
          }
          await fs.rm(target, { recursive: true, force: true })
        },
        catch: (cause) => storeError('removeSession', cause),
      }),
  }
}

export function makeFilesystemSessionResourceStoreLayer(root: string) {
  return Layer.succeed(SessionResourceStore, SessionResourceStore.of(makeStore(root)))
}

export const FilesystemSessionResourceStoreLive = Layer.effect(
  SessionResourceStore,
  Effect.sync(() => {
    const root = path.join(app.getPath('userData'), RESOURCE_DIRECTORY)
    return SessionResourceStore.of(makeStore(root))
  }),
)
