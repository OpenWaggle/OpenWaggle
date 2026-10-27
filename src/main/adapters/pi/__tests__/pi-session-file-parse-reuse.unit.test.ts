import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  clearParsedSessionFileCache,
  loadEntriesFromFileReusingParse,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Every Run opens the Session's Pi file again, and Pi parsed the whole file each time (0.4 s for a
 * 174 MB file). The patched SessionManager keeps a parse per file and, when the file only grew,
 * parses only what was appended. Anything else is parsed whole.
 */

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-parsed-session-'))
  clearParsedSessionFileCache()
})

afterEach(() => {
  clearParsedSessionFileCache()
  rmSync(directory, { recursive: true, force: true })
})

function line(value: unknown) {
  return `${JSON.stringify(value)}\n`
}

const HEADER = line({ type: 'session', version: 3, id: 'session-1', timestamp: 't', cwd: '/repo' })

function messageLine(id: string, parentId: string | null, text: string) {
  return line({
    type: 'message',
    id,
    parentId,
    timestamp: 't',
    message: { role: 'user', content: text, timestamp: 0 },
  })
}

function sessionFile(...lines: string[]) {
  const file = path.join(directory, 'session.jsonl')
  writeFileSync(file, [HEADER, ...lines].join(''))
  return file
}

function ids(entries: ReadonlyArray<{ readonly type: string; readonly id?: string }>) {
  return entries.filter((entry) => entry.type !== 'session').map((entry) => entry.id)
}

describe('reusing a parsed Pi session file', () => {
  it('parses only the appended tail of a file that grew', () => {
    const file = sessionFile(messageLine('a', null, 'first'))
    const first = loadEntriesFromFileReusingParse(file)
    appendFileSync(file, messageLine('b', 'a', 'second'))

    const second = loadEntriesFromFileReusingParse(file)

    expect(ids(second)).toEqual(['a', 'b'])
    // The earlier entries are the same parsed objects; the array is the caller's own.
    expect(second[1]).toBe(first[1])
    expect(second).not.toBe(first)
  })

  it('opens a manager on the reused parse that matches a full open', () => {
    const file = sessionFile(messageLine('a', null, 'first'))
    SessionManager.open(file, undefined, '/repo', { reuseParsedFile: true })
    appendFileSync(file, messageLine('b', 'a', 'second'))

    const reused = SessionManager.open(file, undefined, '/repo', { reuseParsedFile: true })
    const full = SessionManager.open(file, undefined, '/repo')

    expect(reused.getEntries()).toEqual(full.getEntries())
    expect(reused.getLeafId()).toBe('b')
    // A read-only manager pointed at the file reads the same way.
    const readOnly = SessionManager.inMemory('/repo')
    readOnly.setSessionFile(file, { reuseParsedFile: true })
    expect(readOnly.getLeafId()).toBe('b')
  })

  it('parses a rewritten file whole, as after pi --resume', () => {
    const file = sessionFile(messageLine('a', null, 'first'), messageLine('b', 'a', 'second'))
    const first = loadEntriesFromFileReusingParse(file)
    // A rewrite that keeps a longer file: the cached bytes no longer match.
    writeFileSync(
      file,
      [
        HEADER,
        messageLine('x', null, 'other'),
        messageLine('y', 'x', 'branch'),
        messageLine('z', 'y', 'more'),
      ].join(''),
    )

    const second = loadEntriesFromFileReusingParse(file)

    expect(ids(second)).toEqual(['x', 'y', 'z'])
    expect(second[1]).not.toBe(first[1])
  })

  it('parses a file replaced by another whole, even when it starts the same', () => {
    const file = sessionFile(messageLine('a', null, 'first'))
    const first = loadEntriesFromFileReusingParse(file)
    const replacement = path.join(directory, 'replacement.jsonl')
    writeFileSync(
      replacement,
      [HEADER, messageLine('a', null, 'first'), messageLine('b', 'a', 'x')].join(''),
    )
    renameSync(replacement, file)

    const second = loadEntriesFromFileReusingParse(file)

    expect(ids(second)).toEqual(['a', 'b'])
    expect(second[1]).not.toBe(first[1])
  })

  it('parses a shrunk file whole', () => {
    const file = sessionFile(messageLine('a', null, 'first'), messageLine('b', 'a', 'second'))
    loadEntriesFromFileReusingParse(file)
    writeFileSync(file, [HEADER, messageLine('a', null, 'first')].join(''))

    expect(ids(loadEntriesFromFileReusingParse(file))).toEqual(['a'])
  })

  it('reads an unfinished last line like a full load, and caches nothing past it', () => {
    const file = sessionFile(messageLine('a', null, 'first'))
    loadEntriesFromFileReusingParse(file)
    // Another writer is in the middle of its next line.
    const next = messageLine('b', 'a', 'second')
    appendFileSync(file, next.slice(0, 20))

    expect(ids(loadEntriesFromFileReusingParse(file))).toEqual(['a'])

    // Pi's load ends the partial line; the writer's later lines then parse.
    appendFileSync(file, messageLine('c', 'a', 'third'))
    expect(ids(loadEntriesFromFileReusingParse(file))).toEqual(['a', 'c'])
    expect(ids(loadEntriesFromFileReusingParse(file))).toEqual(
      ids(SessionManager.open(file, undefined, '/repo').getEntries()),
    )
  })

  it('keeps up with appends made between and after reads', () => {
    const file = sessionFile(messageLine('a', null, 'first'))
    let parent = 'a'
    for (let index = 0; index < 20; index++) {
      const id = `m${String(index)}`
      appendFileSync(file, messageLine(id, parent, `message ${String(index)}`))
      parent = id
      if (index % 3 === 0) loadEntriesFromFileReusingParse(file)
    }

    expect(ids(loadEntriesFromFileReusingParse(file))).toEqual(
      ids(SessionManager.open(file, undefined, '/repo').getEntries()),
    )
  })

  it('sees the entries a manager on the reused parse appended', () => {
    const file = sessionFile(messageLine('a', null, 'first'))
    const manager = SessionManager.open(file, undefined, '/repo', { reuseParsedFile: true })
    manager.appendMessage({ role: 'user', content: 'from the run', timestamp: 1 })

    const next = SessionManager.open(file, undefined, '/repo', { reuseParsedFile: true })

    expect(next.getEntries()).toHaveLength(2)
    expect(next.getLeafId()).toBe(manager.getLeafId())
  })
})
