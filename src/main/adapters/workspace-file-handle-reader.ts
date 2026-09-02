interface FileRangeReader {
  readonly read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ readonly bytesRead: number }>
}

export async function readBoundedFileRange(
  handle: FileRangeReader,
  length: number,
  position: number,
) {
  const buffer = Buffer.alloc(length)
  let bytesRead = 0
  while (bytesRead < buffer.length) {
    const result = await handle.read(
      buffer,
      bytesRead,
      buffer.length - bytesRead,
      position + bytesRead,
    )
    if (result.bytesRead === 0) break
    bytesRead += result.bytesRead
  }
  return buffer.subarray(0, bytesRead)
}
