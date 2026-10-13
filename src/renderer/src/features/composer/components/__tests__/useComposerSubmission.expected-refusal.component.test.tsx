import type { AgentSendPayload } from '@shared/types/agent'
import { SupportedModelId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import type { SendFailureDisposition } from '../../hooks/useComposerSubmission'
import { useComposerSubmission } from '../../hooks/useComposerSubmission'
import { useComposerStore } from '../../state/composer-store'

const logged = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }))

vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: logged.warn,
    error: logged.error,
  }),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: { discardPreparedAttachment: vi.fn() } }))

const NOTICE = 'Not sent. This Session cannot be continued; its message is back in the composer.'

function renderSubmission(input: {
  readonly onSend: (payload: AgentSendPayload) => Promise<void>
  readonly onSendFailure: (cause: unknown) => SendFailureDisposition
  readonly onToast: (message: string) => void
}) {
  return renderHook(() =>
    useComposerSubmission({
      onSend: input.onSend,
      onEnqueue: () => false,
      isLoading: false,
      requiresText: false,
      clearOnSubmit: true,
      recordHistory: false,
      allowEnqueue: true,
      editorRef: { current: null },
      projectPath: '/repo',
      attachments: [],
      hasPreparingTextAttachment: false,
      onSendFailure: input.onSendFailure,
      onToast: input.onToast,
    }),
  )
}

function rejectedSend() {
  let reject: (cause: Error) => void = () => {}
  const onSend = vi.fn(
    () =>
      new Promise<void>((_resolve, rejectSend) => {
        reject = rejectSend
      }),
  )
  return { onSend, reject: (cause: Error) => reject(cause) }
}

describe('composer send the Session refused for a reason it already shows', () => {
  beforeEach(() => {
    logged.error.mockClear()
    logged.warn.mockClear()
    useComposerStore.getState().reset()
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, selectedModel: SupportedModelId('test/model') },
    }))
    useComposerStore.getState().setActiveDraftContextKey('session:deleted-file')
    useComposerStore.getState().setInput('Are you there?')
  })

  it('gives the text back with a brief toast, and logs no error', async () => {
    const send = rejectedSend()
    const onToast = vi.fn()
    const { result } = renderSubmission({
      onSend: send.onSend,
      onSendFailure: () => ({ kind: 'restore', notice: NOTICE }),
      onToast,
    })

    act(() => result.current.handleSubmit())
    expect(useComposerStore.getState().input).toBe('')
    await act(async () => {
      send.reject(new Error("This Session's Pi session file was deleted outside OpenWaggle"))
      await Promise.resolve()
    })

    await waitFor(() => expect(useComposerStore.getState().input).toBe('Are you there?'))
    expect(onToast).toHaveBeenCalledExactlyOnceWith(NOTICE)
    expect(logged.error).not.toHaveBeenCalled()
    expect(logged.warn).toHaveBeenCalledOnce()
  })

  it('still logs an unexpected send failure as an error', async () => {
    const send = rejectedSend()
    const onToast = vi.fn()
    const { result } = renderSubmission({
      onSend: send.onSend,
      onSendFailure: () => ({ kind: 'restore' }),
      onToast,
    })

    act(() => result.current.handleSubmit())
    await act(async () => {
      send.reject(new Error('The Host stopped'))
      await Promise.resolve()
    })

    await waitFor(() => expect(logged.error).toHaveBeenCalledOnce())
    expect(onToast).not.toHaveBeenCalled()
  })
})
