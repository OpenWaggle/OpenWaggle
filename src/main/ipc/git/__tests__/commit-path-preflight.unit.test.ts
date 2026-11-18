import type * as NodeChildProcess from 'node:child_process'
import type * as NodeFsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { match } from '@diegogbrisa/ts-match'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type GitCallback = (error: Error | null, stdout: string, stderr: string) => void

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  lstat: vi.fn(),
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeChildProcess>()),
  execFile: mocks.execFile,
}))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFsPromises>()),
  lstat: mocks.lstat,
}))
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'openwaggle-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

const { commitGit } = await import('../commit-handler')

const COMMIT_HASH = '0123456789abcdef0123456789abcdef01234567'

function filesystemFailure(code: 'EACCES' | 'EIO') {
  return Object.assign(new Error(`${code}: source path probe failed`), { code })
}

describe('selected commit path preflight', () => {
  beforeEach(() => {
    mocks.execFile.mockReset()
    mocks.lstat.mockReset()
  })

  it.each(['EACCES', 'EIO'] as const)(
    'does not mutate Git when rename-source occupancy fails with %s',
    async (errorCode) => {
      const mutations: string[] = []
      mocks.lstat.mockRejectedValue(filesystemFailure(errorCode))
      mocks.execFile.mockImplementation(
        (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
          const joined = args.join(' ')
          if (args.includes('update-index') || args.includes('add') || args.includes('commit')) {
            mutations.push(joined)
          }
          match(joined)
            .with('rev-parse --show-toplevel', () => callback(null, '/tmp/repo\n', ''))
            .with('rev-parse --is-inside-work-tree', () => callback(null, 'true\n', ''))
            .with('ls-files --unmerged', () => callback(null, '', ''))
            .when(
              () => args.includes('status'),
              () => callback(null, 'R  new.txt\0old.txt\0', ''),
            )
            .otherwise(() => callback(new Error(`Unexpected Git command: ${joined}`), '', ''))
        },
      )

      const result = await commitGit('/tmp/repo', {
        message: 'rename safely',
        amend: false,
        paths: ['new.txt'],
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'unknown',
        message: expect.stringContaining(errorCode),
      })
      expect(mutations).toEqual([])
    },
  )

  it('streams thousands of long legal paths through two bounded mutation processes', async () => {
    const pathCount = 4_000
    const longSegment = 'legal-path-segment-'.repeat(8)
    const paths = Array.from(
      { length: pathCount },
      (_unused, index) =>
        `src/${longSegment}/${longSegment}/${longSegment}/${String(index)}-line\nbreak\ttab\\slash.ts`,
    )
    const mutationCommands: string[] = []
    const standardInput: string[] = []

    mocks.execFile.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        if (args.includes('update-index') || args.includes('commit')) mutationCommands.push(joined)
        match(joined)
          .with('rev-parse --show-toplevel', () => callback(null, '/tmp/repo\n', ''))
          .with('rev-parse --is-inside-work-tree', () => callback(null, 'true\n', ''))
          .with('ls-files --unmerged', () => callback(null, '', ''))
          .with('--literal-pathspecs update-index --add --remove -z --stdin', () =>
            callback(null, '', ''),
          )
          .with(
            '--literal-pathspecs commit -m bulk selected --pathspec-from-file=- --pathspec-file-nul',
            () => callback(null, '[main abc1234] bulk selected\n', ''),
          )
          .with('rev-parse HEAD', () => callback(null, `${COMMIT_HASH}\n`, ''))
          .when(
            () => args.includes('status'),
            () => callback(null, '', ''),
          )
          .otherwise(() => callback(new Error(`Unexpected Git command: ${joined}`), '', ''))

        return {
          stdin: {
            on: vi.fn(),
            end: (input: string) => standardInput.push(input),
          },
        }
      },
    )

    const result = await commitGit('/tmp/repo', {
      message: 'bulk selected',
      amend: false,
      paths,
    })

    expect(result).toMatchObject({ ok: true, commitHash: COMMIT_HASH })
    expect(mutationCommands).toEqual([
      '--literal-pathspecs update-index --add --remove -z --stdin',
      '--literal-pathspecs commit -m bulk selected --pathspec-from-file=- --pathspec-file-nul',
    ])
    expect(mocks.execFile).toHaveBeenCalledTimes(7)
    expect(standardInput).toHaveLength(2)
    expect(standardInput[0]).toBe(`${paths.join('\0')}\0`)
    expect(standardInput[1]).toBe(standardInput[0])
    expect(mutationCommands.some((command) => command.includes(paths[0] ?? 'missing'))).toBe(false)
  })
})
