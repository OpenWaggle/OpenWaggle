import { randomUUID } from 'node:crypto'
import fsPromises from 'node:fs/promises'

/**
 * Atomically write JSON data to a file.
 * Writes to a `.tmp` sibling first, then renames — atomic on POSIX.
 * The temp file is intentionally left on failure for forensics.
 */
export async function atomicWriteJSON(filePath: string, data: unknown, indent = 2): Promise<void> {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`
  await fsPromises.writeFile(tmpPath, JSON.stringify(data, null, indent), 'utf-8')
  await fsPromises.rename(tmpPath, filePath)
}
