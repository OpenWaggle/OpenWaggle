import type { WorkspaceFilesChangedEvent } from '@shared/types/workspace-files'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

type NativeListener = (event: string, name: string | null) => void

const native = vi.hoisted(() => ({ listeners: [] as NativeListener[] }))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  watch: (_root: string, _options: unknown, listener: NativeListener) => {
    native.listeners.push(listener)
    return { on: () => undefined, close: () => undefined, removeListener: () => undefined }
  },
}))
vi.mock('../workspace-git-ignore-filter', () => ({
  WorkspaceGitIgnoreFilter: { create: async () => undefined },
}))
vi.mock('../filesystem-workspace-file-service', () => ({
  invalidateWorkspaceFileIndex: vi.fn(),
}))

const { setWorkspaceWatcherPlatformForTests, unwatchWorkspaceFiles, watchWorkspaceFiles } =
  await import('../workspace-file-watcher')

describe('native workspace watcher events (review R5 P3-3)', () => {
  it('reports an event without a path (a Windows buffer overflow) as an overflow', async () => {
    setWorkspaceWatcherPlatformForTests('win32')
    const events: WorkspaceFilesChangedEvent[] = []
    const subscriber = fromPartial<WebContents>({
      id: 1,
      isDestroyed: () => false,
      once: vi.fn(),
      send: (_channel: string, payload: WorkspaceFilesChangedEvent) => {
        events.push(payload)
      },
    })
    await watchWorkspaceFiles('/project/burst', subscriber)

    native.listeners[0]?.('rename', null)

    await vi.waitFor(() => expect(events).toEqual([expect.objectContaining({ overflow: true })]))
    await unwatchWorkspaceFiles('/project/burst', 1)
  })
})
