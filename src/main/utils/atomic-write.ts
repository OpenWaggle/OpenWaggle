import { randomUUID } from 'node:crypto'
import fsPromises from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_INDENT = 2

/**
 * Atomically write JSON data to a file.
 * Writes to a `.tmp` sibling first, then renames — atomic on POSIX.
 * The temp file is intentionally left on failure for forensics.
 */
export async function atomicWriteJSON(
  filePath: string,
  data: unknown,
  indent = DEFAULT_INDENT,
): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${randomUUID()}.tmp`
  await fsPromises.writeFile(tmpPath, JSON.stringify(data, null, indent), 'utf-8')
  await fsPromises.rename(tmpPath, filePath)
}
