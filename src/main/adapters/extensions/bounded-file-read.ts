import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

export type BoundedFileRead =
  | { readonly kind: 'file'; readonly content: Buffer }
  | { readonly kind: 'not-file' }
  | { readonly kind: 'oversized' }

/**
 * Non-blocking so that opening a FIFO cannot hang; regular files read normally. Windows has no
 * `O_NONBLOCK`, where the constant is undefined and the flag drops out of the bitwise OR. Read on
 * use rather than at import, so modules that only import this file never touch `fs.constants`.
 */
function openFlags() {
  return constants.O_RDONLY | constants.O_NONBLOCK
}

/**
 * Reads a file of at most `maxBytes` bytes. The size check and the read use one file descriptor,
 * and the read stops after `maxBytes + 1` bytes, so a file that is swapped or grows after the
 * check can never be read beyond the bound.
 */
export async function readBoundedFile(
  filePath: string,
  maxBytes: number,
): Promise<BoundedFileRead> {
  const handle = await open(filePath, openFlags())
  try {
    const fileStat = await handle.stat()
    if (!fileStat.isFile()) return { kind: 'not-file' }
    if (fileStat.size > maxBytes) return { kind: 'oversized' }

    const buffer = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    return length > maxBytes
      ? { kind: 'oversized' }
      : { kind: 'file', content: buffer.subarray(0, length) }
  } finally {
    await handle.close()
  }
}
