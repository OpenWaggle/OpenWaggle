export interface AttachmentFileFixture {
  readonly size: number
  readonly content: Buffer
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly mtimeMs: number
}

export function createAttachmentFileHandle(input: {
  readonly filePath: string
  readonly files: Map<string, AttachmentFileFixture>
  readonly persistWrittenFile: (filePath: string, content: Buffer) => void
}) {
  let output = Buffer.alloc(0)
  let wrote = false
  const fixture = () => {
    const file = input.files.get(input.filePath)
    if (!file) throw new Error(`ENOENT: ${input.filePath}`)
    return file
  }
  return {
    stat: async () => {
      const file = fixture()
      return {
        size: file.size,
        isFile: () => file.isFile,
        isDirectory: () => file.isDirectory,
        mtimeMs: file.mtimeMs,
      }
    },
    read: async (buffer: Buffer, offset: number, length: number, position: number) => {
      const file = fixture()
      const bytesRead = file.content.copy(
        buffer,
        offset,
        position,
        Math.min(position + length, file.content.length),
      )
      return { bytesRead, buffer }
    },
    write: async (buffer: Buffer, offset: number, length: number, position: number) => {
      wrote = true
      const chunk = Buffer.from(buffer.subarray(offset, offset + length))
      const requiredBytes = position + chunk.length
      if (output.length < requiredBytes) {
        const grown = Buffer.alloc(requiredBytes)
        output.copy(grown)
        output = grown
      }
      chunk.copy(output, position)
      return { bytesWritten: chunk.length, buffer: chunk }
    },
    close: async () => {
      if (wrote) input.persistWrittenFile(input.filePath, Buffer.from(output))
    },
  }
}
