import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
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

function isWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..'
}

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function makeStore(root: string): SessionResourceStoreShape {
  function storeBytes(input: StoreSessionResourceBytesInput) {
    return Effect.tryPromise({
      try: async () => {
        const sessionDirectory = path.join(root, String(input.sessionId))
        await fs.mkdir(sessionDirectory, { recursive: true })
        const target = path.join(
          sessionDirectory,
          managedFileName(input.resourceId, input.fileName),
        )
        const temporary = `${target}${TEMPORARY_SUFFIX}`
        await fs.writeFile(temporary, input.bytes, { flag: 'wx' })
        await fs.rename(temporary, target)
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
        try: () => fs.readFile(input.sourcePath),
        catch: (cause) => storeError('readSourceFile', cause),
      }).pipe(Effect.flatMap((bytes) => storeBytes({ ...input, bytes }))),
    read: (managedPath) =>
      Effect.tryPromise({
        try: async () => {
          const [realRoot, realPath] = await Promise.all([
            fs.realpath(root),
            fs.realpath(managedPath),
          ])
          if (!isWithinRoot(realRoot, realPath)) {
            throw new Error('Session resource path escapes the managed resource directory.')
          }
          return await fs.readFile(realPath)
        },
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
          const target = path.join(root, String(sessionId))
          if (!isWithinRoot(root, target)) {
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
