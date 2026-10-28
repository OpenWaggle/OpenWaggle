import { closeSync, openSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exit: vi.fn(),
  setActivationPolicy: vi.fn(),
  flush: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({
  app: {
    exit: mocks.exit,
    getVersion: () => '1.2.3',
    isPackaged: true,
    setActivationPolicy: mocks.setActivationPolicy,
  },
}))
vi.mock('../cli-output-flush', () => ({ flushCliOutput: mocks.flush }))

const { answerTopLevelCliInBoot } = await import('../boot-top-level-cli')

const EXECUTABLE = '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle'

function answer(args: readonly string[], cliOutputFd?: string) {
  return answerTopLevelCliInBoot({ argv: [EXECUTABLE, ...args], cliOutputFd, platform: 'darwin' })
}

let stdout: ReturnType<typeof vi.spyOn>
let stderr: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mocks.exit.mockClear()
  mocks.setActivationPolicy.mockClear()
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation((_chunk, encoding, callback) => {
    const done = typeof encoding === 'function' ? encoding : callback
    done?.()
    return true
  })
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation((_chunk, encoding, callback) => {
    const done = typeof encoding === 'function' ? encoding : callback
    done?.()
    return true
  })
})

afterEach(() => {
  stdout.mockRestore()
  stderr.mockRestore()
})

describe('answerTopLevelCliInBoot', () => {
  it('prints the version and exits without loading the main bundle', async () => {
    expect(answer(['--version'])).toBe('answered')

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))
    expect(stdout).toHaveBeenCalledWith('1.2.3\n', 'utf8', expect.any(Function))
    expect(mocks.setActivationPolicy).toHaveBeenCalledWith('accessory')
  })

  it('prints the same help and usage errors as the main bundle', async () => {
    expect(answer(['help'])).toBe('answered')
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('OpenWaggle 1.2.3\n\nUsage:'),
      'utf8',
      expect.any(Function),
    )

    mocks.exit.mockClear()
    expect(answer(['--version', 'extra'])).toBe('answered')
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(2))
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('openwaggle: --version does not accept arguments.'),
      'utf8',
      expect.any(Function),
    )
  })

  it('leaves the desktop app, commands and command groups to the main bundle untouched', () => {
    expect(answer([])).toBe('desktop-app')
    expect(answer(['-psn_0_12345'])).toBe('desktop-app')
    expect(answer(['session-host-internal'])).toBe('session-host')
    for (const args of [
      ['run', 'hello'],
      ['hive', 'list'],
      ['host', 'start'],
    ]) {
      expect(answer(args)).toBe('main-bundle')
    }
    expect(mocks.exit).not.toHaveBeenCalled()
    expect(mocks.setActivationPolicy).not.toHaveBeenCalled()
    expect(stdout).not.toHaveBeenCalled()
  })

  it("writes to the Linux shim's routed descriptor, and leaves a malformed one to the main bundle", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-boot-cli-'))
    const file = path.join(directory, 'out.txt')
    const fd = openSync(file, 'w')
    try {
      expect(answer(['--version'], String(fd))).toBe('answered')
      await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))
      expect(readFileSync(file, 'utf8')).toBe('1.2.3\n')
      expect(stdout).not.toHaveBeenCalled()

      mocks.exit.mockClear()
      expect(answer(['--version'], '1')).toBe('main-bundle')
      expect(mocks.exit).not.toHaveBeenCalled()
    } finally {
      closeSync(fd)
      await rm(directory, { recursive: true, force: true })
    }
  })
})
