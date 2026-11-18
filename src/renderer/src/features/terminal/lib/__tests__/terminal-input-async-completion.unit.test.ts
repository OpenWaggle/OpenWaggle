import type { TerminalInputReleaseResult } from '@shared/types/terminal'
import { fromPartial } from '@total-typescript/shoehorn'
import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { createTerminalClipboardController } from '../terminal-clipboard-controller'
import { createTerminalInputReleaseHandler } from '../terminal-input-attachment'
import { READY, testDispatcher } from './terminal-input-dispatcher-test-harness'

describe('terminal input asynchronous lifetime completion', () => {
  it.each(['resolve', 'reject'] as const)(
    'ignores a retired clipboard %s after recovery',
    async (completion) => {
      const clipboard = Promise.withResolvers<string>()
      const client = testDispatcher(vi.fn()).acquire('session', 'terminal')
      client.markOpen(READY, 0, 'old-record')
      const controller = createTerminalClipboardController({
        terminal: fromPartial<Terminal>({ modes: { bracketedPasteMode: false }, focus: vi.fn() }),
        platform: 'Linux',
        readText: () => clipboard.promise,
        writeText: vi.fn(),
        enqueuePaste: client.enqueueAsync,
        onError: vi.fn(),
      })
      const paste = controller.paste()
      await Promise.resolve()
      client.markOpening()
      client.markOpen(READY, 0, 'new-record')
      client.markOpening()
      client.markOpen(READY, 0, 'new-record')
      if (completion === 'resolve') clipboard.resolve('old clipboard')
      else clipboard.reject(new Error('old clipboard failure'))
      await expect(paste).resolves.toBeUndefined()
      expect(client.snapshot().error).toBeNull()
    },
  )

  it.each(['resolve', 'reject'] as const)('ignores a retired Send now %s', async (completion) => {
    const pending = Promise.withResolvers<TerminalInputReleaseResult>()
    const client = testDispatcher(vi.fn()).acquire('session', 'terminal')
    client.markOpen(READY, 0, 'old-record')
    const release = vi.fn(() => pending.promise)
    const send = createTerminalInputReleaseHandler(client, release, () => true)()
    client.markOpening()
    client.markOpen(READY, 0, 'new-record')
    if (completion === 'resolve') pending.resolve({ status: 'terminal-not-open', releasedBytes: 0 })
    else pending.reject(new Error('old release failure'))
    await expect(send).resolves.toBeUndefined()
    expect(release).toHaveBeenCalledWith('old-record')
    expect(client.snapshot().error).toBeNull()
  })

  it('still reports a failed Send now against the current record', async () => {
    const client = testDispatcher(vi.fn()).acquire('session', 'terminal')
    client.markOpen(READY, 0, 'current-record')
    const send = createTerminalInputReleaseHandler(
      client,
      async () => {
        throw new Error('current release failure')
      },
      () => true,
    )
    await expect(send()).rejects.toThrow('current release failure')
  })
})
