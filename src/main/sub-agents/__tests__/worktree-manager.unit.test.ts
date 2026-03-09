import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  execFileMock,
  readFileMock,
  mkdirMock,
  rmMock,
  statMock,
  atomicWriteJSONMock,
  createLoggerMock,
  loggerMock,
} = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  readFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  rmMock: vi.fn(),
  statMock: vi.fn(),
  atomicWriteJSONMock: vi.fn(),
  createLoggerMock: vi.fn(),
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: readFileMock,
    mkdir: mkdirMock,
    rm: rmMock,
    stat: statMock,
  },
  readFile: readFileMock,
  mkdir: mkdirMock,
  rm: rmMock,
  stat: statMock,
}))

vi.mock('../../utils/atomic-write', () => ({
  atomicWriteJSON: atomicWriteJSONMock,
}))

vi.mock('../../logger', () => ({
  createLogger: createLoggerMock.mockImplementation(() => loggerMock),
}))

import { cleanupOrphanWorktrees, cleanupWorktree, createWorktree } from '../worktree-manager'

describe('worktree-manager', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    readFileMock.mockReset()
    mkdirMock.mockReset()
    rmMock.mockReset()
    statMock.mockReset()
    atomicWriteJSONMock.mockReset()
    createLoggerMock.mockReset()
    loggerMock.debug.mockReset()
    loggerMock.info.mockReset()
    loggerMock.warn.mockReset()
    loggerMock.error.mockReset()

    mkdirMock.mockResolvedValue(undefined)
    rmMock.mockResolvedValue(undefined)
    atomicWriteJSONMock.mockResolvedValue(undefined)
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: readonly string[],
        _options: { cwd: string },
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, '', '')
      },
    )
  })

  it('creates a worktree and persists it into the registry', async () => {
    readFileMock.mockRejectedValueOnce(new Error('ENOENT'))

    const result = await createWorktree('/repo', 'review-agent')

    expect(result).toEqual({
      worktreePath: '/repo/.openwaggle/worktrees/review-agent',
      branch: 'agent/review-agent',
    })
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '/repo/.openwaggle/worktrees/review-agent', '-b', 'agent/review-agent'],
      { cwd: '/repo' },
      expect.any(Function),
    )
    expect(atomicWriteJSONMock).toHaveBeenCalledWith(
      path.join('/repo', '.openwaggle/worktrees/.registry.json'),
      [
        expect.objectContaining({
          name: 'review-agent',
          path: '/repo/.openwaggle/worktrees/review-agent',
          branch: 'agent/review-agent',
        }),
      ],
    )
  })

  it('falls back to removing the directory directly when git worktree remove fails', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([
        {
          name: 'review-agent',
          path: '/repo/.openwaggle/worktrees/review-agent',
          branch: 'agent/review-agent',
          createdAt: 1,
        },
      ]),
    )
    execFileMock.mockImplementation(
      (
        _command: string,
        args: readonly string[],
        _options: { cwd: string },
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
          callback(new Error('cannot remove'), '', 'cannot remove')
          return
        }
        callback(null, '', '')
      },
    )

    await cleanupWorktree('/repo', 'review-agent')

    expect(rmMock).toHaveBeenCalledWith('/repo/.openwaggle/worktrees/review-agent', {
      recursive: true,
    })
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['worktree', 'prune'],
      { cwd: '/repo' },
      expect.any(Function),
    )
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['branch', '-D', 'agent/review-agent'],
      { cwd: '/repo' },
      expect.any(Function),
    )
    expect(atomicWriteJSONMock).toHaveBeenCalledWith(
      path.join('/repo', '.openwaggle/worktrees/.registry.json'),
      [],
    )
  })

  it('removes orphaned entries from the registry and prunes git worktrees', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([
        {
          name: 'missing-agent',
          path: '/repo/.openwaggle/worktrees/missing-agent',
          branch: 'agent/missing-agent',
          createdAt: 1,
        },
        {
          name: 'kept-agent',
          path: '/repo/.openwaggle/worktrees/kept-agent',
          branch: 'agent/kept-agent',
          createdAt: 2,
        },
      ]),
    )
    statMock.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('missing-agent')) {
        const error = new Error('missing')
        Object.assign(error, { code: 'ENOENT' })
        throw error
      }
      return { isFile: () => false }
    })

    await cleanupOrphanWorktrees('/repo')

    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['branch', '-D', 'agent/missing-agent'],
      { cwd: '/repo' },
      expect.any(Function),
    )
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['worktree', 'prune'],
      { cwd: '/repo' },
      expect.any(Function),
    )
    expect(atomicWriteJSONMock).toHaveBeenCalledWith(
      path.join('/repo', '.openwaggle/worktrees/.registry.json'),
      [
        {
          name: 'kept-agent',
          path: '/repo/.openwaggle/worktrees/kept-agent',
          branch: 'agent/kept-agent',
          createdAt: 2,
        },
      ],
    )
  })
})
