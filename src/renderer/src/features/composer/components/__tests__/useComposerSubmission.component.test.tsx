import type { AgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import { SupportedModelId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import type { SendFailureDisposition } from '../../hooks/useComposerSubmission'
import { useComposerSubmission } from '../../hooks/useComposerSubmission'
import { markAttachmentsSubmitted } from '../../state/composer-attachment-lifecycle'
import { useComposerStore } from '../../state/composer-store'

const discardPreparedAttachment = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/shared/lib/ipc', () => ({ api: { discardPreparedAttachment } }))

const image: PreparedAttachment = {
  id: 'session-image',
  kind: 'image',
  origin: 'session-resource',
  name: 'diagram.png',
  path: '/tmp/resource-diagram.png',
  mimeType: 'image/png',
  sizeBytes: 4,
  extractedText: '',
}

function renderSubmission(input: {
  readonly onSend: (payload: AgentSendPayload) => Promise<void> | false
  readonly clearOnSubmit?: boolean
  readonly onSendFailure?: (cause: unknown) => SendFailureDisposition
  readonly onToast?: (message: string) => void
}) {
  return renderHook(() =>
    useComposerSubmission({
      onSend: input.onSend,
      onEnqueue: () => false,
      isLoading: false,
      requiresText: false,
      clearOnSubmit: input.clearOnSubmit ?? true,
      recordHistory: false,
      allowEnqueue: true,
      editorRef: { current: null },
      projectPath: '/repo',
      attachments: useComposerStore.getState().attachments,
      hasPreparingTextAttachment: false,
      onSendFailure: input.onSendFailure,
      onToast: input.onToast,
    }),
  )
}

describe('composer Session image submission ownership', () => {
  beforeEach(() => {
    markAttachmentsSubmitted(useComposerStore.getState().attachments)
    useComposerStore.getState().reset()
    discardPreparedAttachment.mockClear()
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, selectedModel: SupportedModelId('test/model') },
    }))
    useComposerStore.getState().setActiveDraftContextKey('session:one')
    useComposerStore.getState().setInput('Describe this')
    useComposerStore.getState().addAttachments([image])
  })

  it('retains the draft when the send gate refuses it synchronously', () => {
    const onSend = vi.fn(() => false as const)
    const { result } = renderSubmission({ onSend })

    act(() => result.current.handleSubmit())

    expect(onSend).toHaveBeenCalledOnce()
    expect(useComposerStore.getState().input).toBe('Describe this')
    expect(useComposerStore.getState().attachments).toEqual([image])
  })

  it('discards a retained image when removed after a custom branch summary', () => {
    const onSend = vi.fn(async () => undefined)
    const { result } = renderSubmission({ onSend, clearOnSubmit: false })

    act(() => result.current.handleSubmit())
    expect(onSend).toHaveBeenCalledOnce()
    expect(useComposerStore.getState().attachments).toEqual([image])
    expect(discardPreparedAttachment).not.toHaveBeenCalled()

    act(() => useComposerStore.getState().removeAttachment(image.id))
    expect(discardPreparedAttachment).toHaveBeenCalledExactlyOnceWith(image)
  })

  it('keeps draft-owned images after a failed custom branch summary', async () => {
    let rejectSend: (cause: Error) => void = () => undefined
    const onSend = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject
        }),
    )
    const { result } = renderSubmission({
      onSend,
      clearOnSubmit: false,
      onSendFailure: () => ({ kind: 'discard' }),
    })

    act(() => result.current.handleSubmit())
    await act(async () => rejectSend(new Error('Summary failed')))

    expect(useComposerStore.getState().attachments).toEqual([image])
    expect(discardPreparedAttachment).not.toHaveBeenCalled()
    act(() => useComposerStore.getState().removeAttachment(image.id))
    expect(discardPreparedAttachment).toHaveBeenCalledExactlyOnceWith(image)
  })

  it('restores a refused asynchronous send so its image can be retried', async () => {
    let rejectSend: (cause: Error) => void = () => {}
    const onSend = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject
        }),
    )
    const { result } = renderSubmission({ onSend, onSendFailure: () => ({ kind: 'restore' }) })

    act(() => result.current.handleSubmit())
    expect(useComposerStore.getState().attachments).toEqual([])

    await act(async () => {
      rejectSend(new Error('Branch source is unavailable'))
      await Promise.resolve()
    })

    await waitFor(() => expect(useComposerStore.getState().attachments).toEqual([image]))
    expect(useComposerStore.getState().input).toBe('Describe this')
  })

  it('restores a refused image to its original draft after the user switches sessions', async () => {
    let rejectSend: (cause: Error) => void = () => {}
    const onSend = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject
        }),
    )
    const { result } = renderSubmission({ onSend, onSendFailure: () => ({ kind: 'restore' }) })

    act(() => result.current.handleSubmit())
    act(() => useComposerStore.getState().switchScopedDraftContext('session:two'))
    await act(async () => {
      rejectSend(new Error('Branch source is unavailable'))
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(useComposerStore.getState().getScopedDraft('session:one')?.attachments).toEqual([
        image,
      ]),
    )
    expect(useComposerStore.getState().attachments).toEqual([])
  })

  it('merges a refused first-send image into an edited pending Session draft', async () => {
    let rejectSend: (cause: Error) => void = () => {}
    const onSend = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject
        }),
    )
    const { result } = renderSubmission({
      onSend,
      onSendFailure: () => ({ kind: 'restore', contextKey: 'session:created:pending' }),
    })

    act(() => result.current.handleSubmit())
    act(() => {
      useComposerStore.getState().switchScopedDraftContext('session:created:pending')
      useComposerStore.getState().setInput('New thought')
    })
    await act(async () => {
      rejectSend(new Error('First send refused'))
      await Promise.resolve()
    })

    await waitFor(() => expect(useComposerStore.getState().attachments).toEqual([image]))
    expect(useComposerStore.getState().input).toBe('Describe this\n\nNew thought')
  })

  it('warns when a refused send and a new draft together exceed attachment limits', async () => {
    let rejectSend: (cause: Error) => void = () => {}
    const onToast = vi.fn()
    const { result } = renderSubmission({
      onSend: () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject
        }),
      onSendFailure: () => ({ kind: 'restore' }),
      onToast,
    })

    act(() => result.current.handleSubmit())
    act(() =>
      useComposerStore
        .getState()
        .addAttachments(
          Array.from({ length: 5 }, (_, index) => ({ ...image, id: `new-${index}` })),
        ),
    )
    await act(async () => {
      rejectSend(new Error('Send refused'))
      await Promise.resolve()
    })

    expect(useComposerStore.getState().attachments).toHaveLength(6)
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('Remove some before retrying'))
  })

  it('blocks retry when restored attachments exceed the total size limit', async () => {
    let rejectSend: (cause: Error) => void = () => {}
    const onToast = vi.fn()
    useComposerStore.getState().replaceAttachments([{ ...image, sizeBytes: 8 * 1024 * 1024 }])
    const { result } = renderSubmission({
      onSend: () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject
        }),
      onSendFailure: () => ({ kind: 'restore' }),
      onToast,
    })

    act(() => result.current.handleSubmit())
    act(() =>
      useComposerStore.getState().addAttachments([
        { ...image, id: 'second', sizeBytes: 8 * 1024 * 1024 },
        { ...image, id: 'third', sizeBytes: 8 * 1024 * 1024 },
      ]),
    )
    await act(async () => {
      rejectSend(new Error('Send refused'))
      await Promise.resolve()
    })

    expect(useComposerStore.getState().attachments).toHaveLength(3)
    expect(result.current.canSend).toBe(false)
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('20 MB attachment limit'))
  })
})
