import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'

const SHA256_PATTERN = /^[a-f0-9]{64}$/u

interface CopyBoundedSessionResourceFileInput {
  readonly sourcePath: string
  readonly temporaryPath: string
  readonly expectedSizeBytes: number
  readonly expectedSha256?: string
  readonly maxSizeBytes: number
}

function validateLimits(input: CopyBoundedSessionResourceFileInput) {
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

export async function copyBoundedSessionResourceFile(input: CopyBoundedSessionResourceFileInput) {
  validateLimits(input)
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
        throw new Error('Session resource source contents changed before it could be copied.')
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
