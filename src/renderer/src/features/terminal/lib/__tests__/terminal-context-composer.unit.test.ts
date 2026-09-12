import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { appendTerminalContextToComposer } from '../terminal-context-composer'

const mocks = vi.hoisted(() => ({ prepareAttachmentFromText: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({
  api: { prepareAttachmentFromText: mocks.prepareAttachmentFromText },
}))

const PREPARED_ATTACHMENT = {
  id: 'attachment-1',
  kind: 'text' as const,
  origin: 'auto-paste-text' as const,
  name: 'generated.md',
  path: '/tmp/generated.md',
  mimeType: 'text/markdown',
  sizeBytes: 100,
  extractedText: 'generated',
}

describe('appendTerminalContextToComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useComposerStore.setState({
      input: '',
      attachments: [],
      activeDraftContextKey: 'project:/repo',
      lexicalEditor: null,
      cursorIndex: 0,
    })
    mocks.prepareAttachmentFromText.mockResolvedValue(PREPARED_ATTACHMENT)
  })

  it('preserves the draft and adds explicitly untrusted data as a removable context chip', async () => {
    useComposerStore.setState({ input: 'Please diagnose this.' })

    const payload = await appendTerminalContextToComposer({
      terminalId: 'term-1',
      terminalLabel: 'test runner',
      cwd: '/repo',
      provenance: 'session-worktree',
      range: { startLine: 42, endLine: 44 },
      selectedText: 'FAIL src/a.test.ts:42',
    })

    expect(payload).not.toBeNull()
    expect(useComposerStore.getState().input).toBe('Please diagnose this.')
    expect(payload?.xml).toContain('trust="untrusted"')
    expect(mocks.prepareAttachmentFromText).toHaveBeenCalledWith(payload?.xml, expect.any(String))
    expect(useComposerStore.getState().attachments).toEqual([
      expect.objectContaining({
        id: 'attachment-1',
        name: 'Terminal · test runner lines 42-44.md',
      }),
    ])
  })

  it('does not change the composer for blank selections', async () => {
    useComposerStore.setState({ input: 'Keep me.' })

    expect(
      await appendTerminalContextToComposer({
        terminalLabel: 'shell',
        cwd: '/repo',
        provenance: 'opened-checkout',
        selectedText: ' \n ',
      }),
    ).toBeNull()
    expect(useComposerStore.getState().input).toBe('Keep me.')
    expect(mocks.prepareAttachmentFromText).not.toHaveBeenCalled()
  })

  it('does not attach prepared context into a draft the user switched away from', async () => {
    const preparation = Promise.withResolvers<typeof PREPARED_ATTACHMENT>()
    mocks.prepareAttachmentFromText.mockReturnValue(preparation.promise)
    const attaching = appendTerminalContextToComposer({
      terminalLabel: 'shell',
      cwd: '/repo',
      provenance: 'opened-checkout',
      selectedText: 'output',
    })
    useComposerStore.setState({ activeDraftContextKey: 'project:/other' })
    preparation.resolve(PREPARED_ATTACHMENT)

    await expect(attaching).rejects.toThrow('active draft changed')
    expect(useComposerStore.getState().attachments).toEqual([])
  })
})
