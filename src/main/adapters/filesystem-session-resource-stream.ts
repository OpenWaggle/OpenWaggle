import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

const RESOURCE_STREAM_CHUNK_SIZE_BYTES = 64 * 1_024

function isWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..'
}

interface ManagedPathIdentity {
  readonly path: string
  readonly dev: number
  readonly ino: number
  readonly kind: 'directory' | 'file'
}

function sameIdentity(
  expected: Pick<ManagedPathIdentity, 'dev' | 'ino'>,
  actual: { readonly dev: number; readonly ino: number },
) {
  return expected.dev === actual.dev && expected.ino === actual.ino
}

async function captureManagedPathIdentities(realRoot: string, realPath: string) {
  const relativePath = path.relative(realRoot, realPath)
  const segments = relativePath.split(path.sep).filter(Boolean)
  const identities: ManagedPathIdentity[] = []
  let candidate = realRoot
  for (const [index, segment] of [path.basename(realRoot), ...segments].entries()) {
    if (index > 0) candidate = path.join(candidate, segment)
    const stats = await fs.lstat(candidate)
    const kind = index === segments.length ? 'file' : 'directory'
    if (stats.isSymbolicLink() || (kind === 'file' ? !stats.isFile() : !stats.isDirectory())) {
      throw new Error(`Session resource path contains an invalid managed ${kind}.`)
    }
    identities.push({ path: candidate, dev: stats.dev, ino: stats.ino, kind })
  }
  return identities
}

async function assertManagedPathIdentitiesUnchanged(identities: readonly ManagedPathIdentity[]) {
  for (const identity of identities) {
    const stats = await fs.lstat(identity.path)
    if (
      stats.isSymbolicLink() ||
      !sameIdentity(identity, stats) ||
      (identity.kind === 'file' ? !stats.isFile() : !stats.isDirectory())
    ) {
      throw new Error('Session resource path changed while its file was being opened.')
    }
  }
}

export async function openManagedSessionResourceFile(root: string, managedPath: string) {
  const [realRoot, realPath] = await Promise.all([fs.realpath(root), fs.realpath(managedPath)])
  if (!isWithinRoot(realRoot, realPath)) {
    throw new Error('Session resource path escapes the managed resource directory.')
  }
  const identities = await captureManagedPathIdentities(realRoot, realPath)
  const expectedFile = identities.at(-1)
  if (!expectedFile) throw new Error('Session resource path has no managed file.')
  const handle = await fs.open(realPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const openedFile = await handle.stat()
    if (!openedFile.isFile() || !sameIdentity(expectedFile, openedFile)) {
      throw new Error('Session resource file changed while it was being opened.')
    }
    await assertManagedPathIdentitiesUnchanged(identities)
    return handle
  } catch (cause) {
    await handle.close().catch(() => {})
    throw cause
  }
}

export async function openManagedSessionResourceStream(root: string, managedPath: string) {
  const handle = await openManagedSessionResourceFile(root, managedPath)
  let closed = false
  async function close() {
    if (closed) return
    closed = true
    await handle.close().catch(() => {})
  }
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      try {
        const chunk = new Uint8Array(RESOURCE_STREAM_CHUNK_SIZE_BYTES)
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null)
        if (bytesRead === 0) {
          await close()
          controller.close()
          return
        }
        controller.enqueue(bytesRead === chunk.byteLength ? chunk : chunk.slice(0, bytesRead))
      } catch (cause) {
        await close()
        controller.error(cause)
      }
    },
    cancel: close,
  })
}
