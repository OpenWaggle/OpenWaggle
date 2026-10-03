import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBoundedFile } from '../bounded-file-read'

const MAX_BYTES = 8

let tmpRoot = ''

async function writeBytes(name: string, length: number) {
  const filePath = path.join(tmpRoot, name)
  await fs.writeFile(filePath, 'x'.repeat(length), 'utf-8')
  return filePath
}

describe('readBoundedFile', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-bounded-read-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('reads a file up to the limit', async () => {
    const read = await readBoundedFile(await writeBytes('exact', MAX_BYTES), MAX_BYTES)

    expect(read).toEqual({ kind: 'file', content: Buffer.from('x'.repeat(MAX_BYTES)) })
  })

  it('reports a file over the limit as oversized', async () => {
    const read = await readBoundedFile(await writeBytes('large', MAX_BYTES + 1), MAX_BYTES)

    expect(read).toEqual({ kind: 'oversized' })
  })

  it('reports a directory as not a file', async () => {
    expect(await readBoundedFile(tmpRoot, MAX_BYTES)).toEqual({ kind: 'not-file' })
  })

  it('rejects when the file does not exist', async () => {
    await expect(readBoundedFile(path.join(tmpRoot, 'missing'), MAX_BYTES)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
