import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface WatcherMockInstance {
  close: ReturnType<typeof vi.fn>
  emitReady: () => void
}

interface WatcherMocks {
  instances: WatcherMockInstance[]
  watch: ReturnType<typeof vi.fn>
}

const watcherMocks = vi.hoisted(
  (): WatcherMocks => ({
    instances: [],
    watch: vi.fn(),
  }),
)

watcherMocks.watch.mockImplementation(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const watcher = {
    close: vi.fn(async () => undefined),
    on(type: string, listener: (...args: unknown[]) => void) {
      const entries = listeners.get(type) ?? []
      entries.push(listener)
      listeners.set(type, entries)
      return watcher
    },
    once(type: string, listener: (...args: unknown[]) => void) {
      const onceListener = (...args: unknown[]) => {
        const entries = listeners.get(type) ?? []
        listeners.set(
          type,
          entries.filter((entry) => entry !== onceListener),
        )
        listener(...args)
      }
      return watcher.on(type, onceListener)
    },
    emitReady() {
      for (const listener of listeners.get('ready') ?? []) listener()
    },
  }
  watcherMocks.instances.push(watcher)
  return watcher
})

vi.mock('chokidar', () => ({ watch: watcherMocks.watch }))
vi.mock('../filesystem-workspace-file-service', () => ({
  invalidateWorkspaceFileIndex: vi.fn(),
}))

import { unwatchWorkspaceFiles, watchWorkspaceFiles } from '../workspace-file-watcher'

function webContents(id: number): WebContents {
  return fromPartial<WebContents>({
    id,
    isDestroyed: () => false,
    once: vi.fn(),
    send: vi.fn(),
  })
}

describe('workspace watcher lifecycle', () => {
  afterEach(() => {
    watcherMocks.instances = []
    watcherMocks.watch.mockClear()
  })

  it('shares pending startup and closes it when every subscriber leaves before ready', async () => {
    const root = '/project/pending'
    const firstSubscriber = webContents(1)
    const secondSubscriber = webContents(2)
    const first = watchWorkspaceFiles(root, firstSubscriber)
    const second = watchWorkspaceFiles(root, secondSubscriber)

    expect(watcherMocks.watch).toHaveBeenCalledTimes(1)
    const watcher = watcherMocks.instances[0]
    if (!watcher) throw new Error('Expected a pending watcher.')
    await Promise.all([
      unwatchWorkspaceFiles(root, firstSubscriber.id),
      unwatchWorkspaceFiles(root, secondSubscriber.id),
    ])
    watcher.emitReady()
    await Promise.all([first, second])
    expect(watcher.close).toHaveBeenCalledOnce()
  })

  it('keeps one ready watcher until its final subscriber leaves', async () => {
    const root = '/project/ready'
    const firstSubscriber = webContents(3)
    const secondSubscriber = webContents(4)
    const first = watchWorkspaceFiles(root, firstSubscriber)
    const second = watchWorkspaceFiles(root, secondSubscriber)
    const watcher = watcherMocks.instances[0]
    if (!watcher) throw new Error('Expected a watcher.')
    watcher.emitReady()
    await Promise.all([first, second])

    await unwatchWorkspaceFiles(root, firstSubscriber.id)
    expect(watcher.close).not.toHaveBeenCalled()
    await unwatchWorkspaceFiles(root, secondSubscriber.id)
    expect(watcher.close).toHaveBeenCalledOnce()
  })
})
