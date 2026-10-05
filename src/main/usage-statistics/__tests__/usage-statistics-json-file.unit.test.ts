import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const warnings = vi.hoisted(() => {
  const logged: { readonly message: string; readonly data: unknown }[] = []
  return logged
})

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: (message: string, data: unknown) => warnings.push({ message, data }),
    error: vi.fn(),
  }),
}))

import {
  openUsageStatisticsJsonFile,
  readUsageStatisticsJsonFile,
} from '../usage-statistics-json-file'

interface Counter {
  readonly count: number
}

function decodeCounter(value: unknown): Counter {
  if (typeof value !== 'object' || value === null || !('count' in value)) {
    throw new Error('not a counter')
  }
  const { count } = value
  if (typeof count !== 'number') throw new Error('not a counter')
  return { count }
}

let directory = ''
const filePath = () => path.join(directory, 'state.json')

function open(writeDelayMs = 5) {
  return openUsageStatisticsJsonFile<Counter>({
    filePath: filePath(),
    label: 'state.json',
    decode: decodeCounter,
    initial: { count: 0 },
    recover: () => ({ count: -1 }),
    writeDelayMs,
  })
}

async function readCounter() {
  return decodeCounter(JSON.parse(await readFile(filePath(), 'utf8')))
}

describe('Usage statistics JSON file', () => {
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-usage-json-'))
    warnings.length = 0
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('replaces the whole file privately and leaves no temporary file behind', async () => {
    const file = open()
    file.update(() => ({ count: 1 }))
    file.update((current) => ({ count: current.count + 1 }))
    await file.flush()

    expect(await readCounter()).toEqual({ count: 2 })
    expect(await readdir(directory)).toEqual(['state.json'])
    if (process.platform !== 'win32') {
      expect((await stat(filePath())).mode & 0o777).toBe(0o600)
    }
  })

  it('replaces a corrupt file with the recovered value and logs it without a path', async () => {
    await writeFile(filePath(), '{"count":')

    const file = open()
    expect(file.read()).toEqual({ count: -1 })
    await file.flush()

    expect(await readCounter()).toEqual({ count: -1 })
    expect(warnings).toEqual([
      {
        message: 'Usage statistics state is corrupt; starting again',
        data: expect.objectContaining({ file: 'state.json' }),
      },
    ])
    expect(JSON.stringify(warnings)).not.toContain(directory)
  })

  it('reports a failed write to flush and retries it until it is saved', async () => {
    // A directory where the file should be makes every rename fail.
    await mkdir(filePath())
    const file = open()
    file.update(() => ({ count: 7 }))

    await expect(file.flush()).rejects.toThrow()
    expect(warnings.at(-1)?.message).toBe('Usage statistics state could not be saved; retrying')

    await rm(filePath(), { recursive: true })
    await vi.waitFor(async () => expect(await readCounter()).toEqual({ count: 7 }), {
      timeout: 2_000,
    })
    await expect(file.flush()).resolves.toBeUndefined()
  })

  it('writes a pending change synchronously before the process exits', async () => {
    const file = open(60_000)
    file.update(() => ({ count: 3 }))

    file.flushSync()

    expect(await readCounter()).toEqual({ count: 3 })
    expect(await readdir(directory)).toEqual(['state.json'])
  })

  it('does not rewrite the file for a change that returns the same value', async () => {
    const file = open()
    file.update(() => ({ count: 1 }))
    await file.flush()
    await rm(filePath())

    file.update((current) => current)
    await file.flush()
    file.flushSync()

    await expect(stat(filePath())).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes temporary files a crash left beside it, only when its owner opens it', async () => {
    await writeFile(filePath(), JSON.stringify({ count: 4 }))
    await writeFile(path.join(directory, 'state.json.4242.tmp'), '{"count":')
    await writeFile(path.join(directory, 'state.json.4243.exit.tmp'), '{"count":')
    await writeFile(path.join(directory, 'other.json.4242.tmp'), '{}')

    // A reader of another process's file must not touch that process's temporary files.
    readUsageStatisticsJsonFile({
      filePath: filePath(),
      label: 'state.json',
      decode: decodeCounter,
      fallback: { count: 0 },
    })
    expect((await readdir(directory)).sort()).toEqual([
      'other.json.4242.tmp',
      'state.json',
      'state.json.4242.tmp',
      'state.json.4243.exit.tmp',
    ])

    expect(open().read()).toEqual({ count: 4 })
    expect((await readdir(directory)).sort()).toEqual(['other.json.4242.tmp', 'state.json'])
  })
})
