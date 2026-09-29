import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ broadcast: vi.fn() }))

vi.mock('../utils/broadcast', () => ({ broadcastToWindows: mocks.broadcast }))

const { claimAppInstance, requestOpenProject, takeOpenProjectRequest } = await import(
  '../open-project-requests'
)
type AppInstanceHost = Parameters<typeof claimAppInstance>[0]['host']
type SecondInstanceListener = Parameters<AppInstanceHost['on']>[1]

const root = mkdtempSync(path.join(tmpdir(), 'openwaggle-open-project-'))
const project = path.join(root, 'project')
const file = path.join(root, 'notes.txt')
mkdirSync(project, { recursive: true })
writeFileSync(file, 'x')

function fakeHost(lockGranted: boolean) {
  const listeners: SecondInstanceListener[] = []
  const lockData: unknown[] = []
  const host: AppInstanceHost = {
    requestSingleInstanceLock: (data) => {
      lockData.push(data)
      return lockGranted
    },
    on: (_event, listener) => {
      listeners.push(listener)
    },
  }
  const launchAgain = (data: unknown) => {
    for (const listener of listeners) listener({}, [], root, data)
  }
  return { host, lockData, launchAgain, listeners }
}

beforeEach(() => {
  while (takeOpenProjectRequest() !== null) {
    // Drain requests left by an earlier test.
  }
  mocks.broadcast.mockClear()
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('command-line project requests', () => {
  it('holds one canonical request until a renderer takes it', () => {
    requestOpenProject(project)

    expect(mocks.broadcast).toHaveBeenCalledWith('app:open-project-requested', null)
    expect(takeOpenProjectRequest()).toBe(realpathSync.native(project))
    expect(takeOpenProjectRequest()).toBeNull()
  })

  it('hands out several waiting requests oldest first, without repeating one', () => {
    requestOpenProject(project)
    requestOpenProject(project)
    requestOpenProject(root)

    expect(takeOpenProjectRequest()).toBe(realpathSync.native(project))
    expect(takeOpenProjectRequest()).toBe(realpathSync.native(root))
    expect(takeOpenProjectRequest()).toBeNull()
  })

  it('ignores relative paths, files, and missing paths', () => {
    requestOpenProject('project')
    requestOpenProject(file)
    requestOpenProject(path.join(root, 'missing'))

    expect(takeOpenProjectRequest()).toBeNull()
    expect(mocks.broadcast).not.toHaveBeenCalled()
  })
})

describe('app instance claim', () => {
  it('opens the requested project in the first instance once it owns the lock', () => {
    const { host, lockData } = fakeHost(true)

    const claim = claimAppInstance({
      host,
      openProjectPath: project,
      singleInstance: true,
      revealWindow: vi.fn(),
    })

    expect(claim).toBe('primary')
    expect(lockData).toEqual([{ openProjectPath: project }])
    expect(takeOpenProjectRequest()).toBe(realpathSync.native(project))
  })

  it('hands the project to the running app and opens nothing itself when the lock is taken', () => {
    const { host, lockData, listeners } = fakeHost(false)

    const claim = claimAppInstance({
      host,
      openProjectPath: project,
      singleInstance: true,
      revealWindow: vi.fn(),
    })

    expect(claim).toBe('secondary')
    expect(lockData).toEqual([{ openProjectPath: project }])
    expect(listeners).toEqual([])
    expect(takeOpenProjectRequest()).toBeNull()
  })

  it('reveals a window for every later launch and accepts only a valid project', () => {
    const { host, lockData, launchAgain } = fakeHost(true)
    const revealWindow = vi.fn()
    claimAppInstance({ host, openProjectPath: undefined, singleInstance: true, revealWindow })
    expect(lockData).toEqual([undefined])

    launchAgain({ openProjectPath: project })
    expect(revealWindow).toHaveBeenCalledTimes(1)
    expect(takeOpenProjectRequest()).toBe(realpathSync.native(project))

    launchAgain({ unexpected: true })
    launchAgain({ openProjectPath: 'relative' })
    launchAgain(undefined)
    expect(revealWindow).toHaveBeenCalledTimes(4)
    expect(takeOpenProjectRequest()).toBeNull()
  })

  it('skips the lock when single-instance mode is disabled', () => {
    const { host, lockData } = fakeHost(false)

    expect(
      claimAppInstance({
        host,
        openProjectPath: project,
        singleInstance: false,
        revealWindow: vi.fn(),
      }),
    ).toBe('primary')
    expect(lockData).toEqual([])
    expect(takeOpenProjectRequest()).toBe(realpathSync.native(project))
  })
})
