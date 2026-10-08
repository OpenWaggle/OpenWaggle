import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rekeySessionLines, writeSessionLinesAtomically } from '../fork-entry-identity'

let directory = ''
let file = ''

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-lines-'))
  file = path.join(directory, 'session.jsonl')
  await fs.writeFile(
    file,
    '{"type":"session","id":"s"}\n{"type":"message","id":"a","parentId":null}\n',
  )
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('writeSessionLinesAtomically', () => {
  it('replaces the file and leaves no temporary file behind', async () => {
    const before = await fs.stat(file)

    const written = await writeSessionLinesAtomically(file, [{ type: 'session', id: 's' }], {
      unchangedSince: { size: before.size, mtimeMs: before.mtimeMs },
    })

    expect(written).toBe(true)
    expect(await fs.readFile(file, 'utf8')).toBe('{"type":"session","id":"s"}\n')
    expect(await fs.readdir(directory)).toEqual(['session.jsonl'])
  })

  it('keeps an append that raced the rewrite instead of overwriting it', async () => {
    const before = await fs.stat(file)
    await fs.appendFile(file, '{"type":"message","id":"b","parentId":"a"}\n')
    const appended = await fs.readFile(file, 'utf8')

    const written = await writeSessionLinesAtomically(file, [{ type: 'session', id: 's' }], {
      unchangedSince: { size: before.size, mtimeMs: before.mtimeMs },
    })

    expect(written).toBe(false)
    expect(await fs.readFile(file, 'utf8')).toBe(appended)
    expect(await fs.readdir(directory)).toEqual(['session.jsonl'])
  })
})

describe('rekeySessionLines', () => {
  it('renames only the selected entries and follows their references', () => {
    const { lines, sourceIdById } = rekeySessionLines(
      [
        { type: 'session', id: 's' },
        { type: 'message', id: 'a', parentId: null },
        { type: 'message', id: 'b', parentId: 'a' },
        { type: 'label', id: 'c', parentId: 'b', targetId: 'a' },
      ],
      (id) => id === 'a',
    )
    const [newId] = [...sourceIdById.keys()]

    expect(sourceIdById.get(newId ?? '')).toBe('a')
    expect(lines).toEqual([
      { type: 'session', id: 's' },
      { type: 'message', id: newId, parentId: null },
      { type: 'message', id: 'b', parentId: newId },
      { type: 'label', id: 'c', parentId: 'b', targetId: newId },
    ])
  })
})
