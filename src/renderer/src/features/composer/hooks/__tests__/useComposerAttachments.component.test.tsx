import type { PreparedAttachment } from '@shared/types/agent'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '../../state/composer-store'
import { useComposerAttachments } from '../useComposerAttachments'

const mocks = vi.hoisted(() => ({
  prepareAttachmentFromText:
    vi.fn<(text: string, operationId: string, name?: string) => Promise<PreparedAttachment>>(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { prepareAttachmentFromText: mocks.prepareAttachmentFromText },
}))

const pastedText = 'x'.repeat(12_001)
const pastedAttachment: PreparedAttachment = {
  id: 'pasted-a',
  kind: 'text',
  name: 'pasted.txt',
  path: '/tmp/pasted-a.txt',
  mimeType: 'text/plain',
  sizeBytes: 12_001,
  extractedText: pastedText.slice(0, 12_000),
}

describe('composer long-paste isolation', () => {
  beforeEach(() => {
    mocks.prepareAttachmentFromText.mockReset()
    useComposerStore.setState(useComposerStore.getInitialState())
  })

  it.each(['success', 'failure'])(
    'ignores previous-draft preparation %s after navigation',
    async (outcome) => {
      let finish: () => void = () => undefined
      mocks.prepareAttachmentFromText.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = () => {
              if (outcome === 'success') resolve(pastedAttachment)
              else reject(new Error('Attachment preparation failed'))
            }
          }),
      )
      useComposerStore.getState().switchScopedDraftContext('draft-a')
      const hook = renderHook(() => useComposerAttachments({ projectPath: '/project' }))
      act(() => {
        expect(hook.result.current.checkAndConvertPaste(pastedText, 'draft A')).toBe(true)
      })
      act(() => {
        useComposerStore.getState().switchScopedDraftContext('draft-b')
        useComposerStore.getState().setInput('draft B')
      })
      await act(async () => finish())
      expect(useComposerStore.getState().input).toBe('draft B')
      expect(hook.result.current.attachments).toHaveLength(0)
      expect(hook.result.current.hasPreparingTextAttachment).toBe(false)
    },
  )

  it('preserves newer text typed in the same draft when preparation fails', async () => {
    let fail: (error: Error) => void = () => undefined
    mocks.prepareAttachmentFromText.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        }),
    )
    useComposerStore.getState().switchScopedDraftContext('draft-a')
    useComposerStore.getState().setInput('draft A')
    const hook = renderHook(() => useComposerAttachments({ projectPath: '/project' }))
    act(() => {
      expect(hook.result.current.checkAndConvertPaste(pastedText, 'draft A')).toBe(true)
    })
    act(() => useComposerStore.getState().setInput('draft A with more typing'))
    await act(async () => fail(new Error('Attachment preparation failed')))
    expect(useComposerStore.getState().input).toBe('draft A with more typing')
    expect(hook.result.current.attachments).toHaveLength(0)
    expect(hook.result.current.hasPreparingTextAttachment).toBe(false)
  })

  it('does not start long-paste conversion while the draft is disabled', () => {
    mocks.prepareAttachmentFromText.mockResolvedValue(pastedAttachment)
    const hook = renderHook(() =>
      useComposerAttachments({ projectPath: '/project', disabled: true }),
    )
    act(() => {
      expect(hook.result.current.checkAndConvertPaste(pastedText, '')).toBe(false)
    })
    expect(mocks.prepareAttachmentFromText).not.toHaveBeenCalled()
  })

  it('keeps long-paste conversion available to a fresh draft without a Session', async () => {
    mocks.prepareAttachmentFromText.mockResolvedValue(pastedAttachment)
    const hook = renderHook(() => useComposerAttachments({ projectPath: '/project' }))
    await act(async () => {
      expect(hook.result.current.checkAndConvertPaste(pastedText, '')).toBe(true)
    })
    expect(hook.result.current.attachments.map((attachment) => attachment.id)).toEqual(['pasted-a'])
    expect(hook.result.current.hasPreparingTextAttachment).toBe(false)
  })

  it('asks the Host to name a long paste after its chip, so the sent message shows that name', async () => {
    mocks.prepareAttachmentFromText.mockImplementation(async (_text, _operationId, name) => ({
      ...pastedAttachment,
      name: name ?? pastedAttachment.name,
    }))
    const hook = renderHook(() => useComposerAttachments({ projectPath: '/project' }))
    await act(async () => {
      expect(hook.result.current.checkAndConvertPaste(pastedText, '')).toBe(true)
    })
    expect(mocks.prepareAttachmentFromText).toHaveBeenCalledWith(
      pastedText,
      expect.any(String),
      'Pasted Text 1.md',
    )
    expect(hook.result.current.attachments.map((attachment) => attachment.name)).toEqual([
      'Pasted Text 1.md',
    ])
  })
})
