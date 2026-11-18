import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  piSessionFileContentHasTail,
  piSessionFileStillHasTail,
  piSessionFileTailOf,
  readPiSessionFileTail,
} from '../pi-session-file-tail'

let root = ''
let file = ''

const HEADER = JSON.stringify({ type: 'session', version: 3, id: 'session', cwd: '/tmp/x' })
const entry = (id: string, text = id) =>
  JSON.stringify({ type: 'message', id, parentId: null, message: { role: 'user', text } })

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-file-tail-'))
  file = path.join(root, 'session.jsonl')
  writeFileSync(file, `${[HEADER, entry('a'), entry('b')].join('\n')}\n`)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('a Pi file tail', () => {
  it('ends at the last complete entry', () => {
    const tail = readPiSessionFileTail(file)
    expect(tail).toMatchObject({ offset: readFileSync(file).length, lastEntryId: 'b' })
    expect(piSessionFileTailOf(readFileSync(file))).toEqual(tail)
  })

  it('is not taken from a file that ends in a partial line or only a header', () => {
    appendFileSync(file, '{"type":"message","id":"c"')
    expect(readPiSessionFileTail(file)).toBeNull()
    writeFileSync(file, `${HEADER}\n`)
    expect(readPiSessionFileTail(file)).toBeNull()
  })

  it('is still there after appends', () => {
    const tail = readPiSessionFileTail(file)
    if (!tail) throw new Error('no tail')
    appendFileSync(file, `${entry('c')}\n`)
    expect(piSessionFileStillHasTail(file, tail)).toBe(true)
    expect(piSessionFileContentHasTail(readFileSync(file), tail)).toBe(true)
  })

  it('is gone after the file shrank, its header changed, or its last entry was rewritten', () => {
    const tail = readPiSessionFileTail(file)
    if (!tail) throw new Error('no tail')
    writeFileSync(file, `${[HEADER, entry('a')].join('\n')}\n`)
    expect(piSessionFileStillHasTail(file, tail)).toBe(false)

    writeFileSync(file, `${[HEADER.replace('3', '4'), entry('a'), entry('b')].join('\n')}\n`)
    expect(piSessionFileStillHasTail(file, tail)).toBe(false)

    // Same length, same id, other content: the rewritten line's bytes differ.
    writeFileSync(file, `${[HEADER, entry('a'), entry('b', 'x')].join('\n')}\n`)
    expect(piSessionFileStillHasTail(file, tail)).toBe(false)
    expect(piSessionFileContentHasTail(readFileSync(file), tail)).toBe(false)
  })
})
