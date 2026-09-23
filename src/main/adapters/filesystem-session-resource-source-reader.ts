import fs from 'node:fs/promises'
import path from 'node:path'
import { MAX_CAPTURED_IMAGE_BYTES } from '../domain/session-resource-image'
import type { ReadSessionResourceSourceInput } from '../ports/session-resource-store'

const SOURCE_READ_SENTINEL_BYTES = 1

function isWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..'
}

export async function readBoundedSessionResourceSource(input: ReadSessionResourceSourceInput) {
  if (
    input.allowedRoots.length === 0 ||
    !Number.isSafeInteger(input.maxSizeBytes) ||
    input.maxSizeBytes <= 0 ||
    input.maxSizeBytes > MAX_CAPTURED_IMAGE_BYTES
  ) {
    throw new Error('Session resource source read limits are invalid.')
  }
  const roots = await Promise.all(
    input.allowedRoots.map((root) => fs.realpath(root).catch(() => null)),
  )
  const handle = await fs.open(input.sourcePath, 'r')
  try {
    const [sourcePath, stats] = await Promise.all([
      fs.realpath(input.sourcePath),
      handle.stat({ bigint: true }),
    ])
    if (!roots.some((root) => root !== null && isWithinRoot(root, sourcePath))) {
      throw new Error('Session resource source is outside the authorized roots.')
    }
    const canonicalStats = await fs.stat(sourcePath, { bigint: true })
    if (stats.dev !== canonicalStats.dev || stats.ino !== canonicalStats.ino) {
      throw new Error('Session resource source changed while it was being authorized.')
    }
    if (!stats.isFile() || stats.size <= 0n || stats.size > BigInt(input.maxSizeBytes)) {
      throw new Error('Session resource source is not a bounded regular file.')
    }
    const bytes = Buffer.allocUnsafe(Number(stats.size) + SOURCE_READ_SENTINEL_BYTES)
    let offset = 0
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset <= 0 || offset > input.maxSizeBytes) {
      throw new Error('Session resource source exceeds its allowed size.')
    }
    return bytes.subarray(0, offset)
  } finally {
    await handle.close().catch(() => {})
  }
}
