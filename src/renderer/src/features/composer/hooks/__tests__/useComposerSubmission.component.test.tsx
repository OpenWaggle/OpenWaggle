import type { PreparedAttachment } from '@shared/types/agent'
import { act, renderHook } from '@testing-library/react'
import type { LexicalEditor } from 'lexical'
import type { RefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '../../state/composer-store'
import { useComposerSubmission } from '../useComposerSubmission'

vi.mock('@/features/providers/hooks', () => ({
  useSelectedModelThinkingLevel: () => ({ effectiveThinkingLevel: 'off' }),
}))

vi.mock('../useComposerModel', () => ({
  useComposerModel: () => ({ model: 'openai/test-model', isSessionModel: true }),
}))

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderSubmission(onEnqueue: () => Promise<void>) {
  const editorRef: RefObject<LexicalEditor | null> = { current: null }
  return renderHook(() =>
    useComposerSubmission({
      onSend: vi.fn(),
      onEnqueue,
      isLoading: true,
      requiresText: false,
      clearOnSubmit: true,
      recordHistory: true,
      allowEnqueue: true,
      editorRef,
      projectPath: '/tmp/openwaggle-project',
      attachments: useComposerStore.getState().attachments,
      hasPreparingTextAttachment: false,
    }),
  )
}

describe('useComposerSubmission Follow-up lifecycle', () => {
  beforeEach(() => {
    const attachment: PreparedAttachment = {
      id: 'attachment-a',
      kind: 'text',
      name: 'context.txt',
      path: '/tmp/context.txt',
      mimeType: 'text/plain',
      sizeBytes: 7,
      extractedText: 'context',
    }
    useComposerStore.setState(useComposerStore.getInitialState())
    useComposerStore.setState({
      activeDraftContextKey: 'session:session-a',
      attachments: [attachment],
      input: 'keep this draft',
    })
  })

  it('keeps the draft until the Host accepts the Follow-up', async () => {
    const request = deferred()
    const { result } = renderSubmission(() => request.promise)

    let submission!: Promise<boolean>
    act(() => {
      submission = Promise.resolve(result.current.handleSubmit())
    })

    expect(useComposerStore.getState().input).toBe('keep this draft')
    expect(useComposerStore.getState().attachments).toHaveLength(1)

    await act(async () => {
      request.resolve()
      await submission
    })

    expect(useComposerStore.getState().input).toBe('')
    expect(useComposerStore.getState().attachments).toHaveLength(0)
    expect(useComposerStore.getState().promptHistory).toContain('keep this draft')
  })

  it('preserves the draft when the Host rejects the Follow-up', async () => {
    const request = deferred()
    const { result } = renderSubmission(() => request.promise)

    let submission!: Promise<boolean>
    act(() => {
      submission = Promise.resolve(result.current.handleSubmit())
    })

    await act(async () => {
      request.reject(new Error('Session Host unavailable'))
      await submission
    })

    expect(useComposerStore.getState().input).toBe('keep this draft')
    expect(useComposerStore.getState().attachments).toHaveLength(1)
    expect(useComposerStore.getState().promptHistory).not.toContain('keep this draft')
  })

  it('does not clear a newer draft when an earlier Follow-up succeeds', async () => {
    const request = deferred()
    const { result } = renderSubmission(() => request.promise)

    let submission!: Promise<boolean>
    act(() => {
      submission = Promise.resolve(result.current.handleSubmit())
      useComposerStore.getState().setInput('a newer draft')
    })

    await act(async () => {
      request.resolve()
      await submission
    })

    expect(useComposerStore.getState().input).toBe('a newer draft')
  })
})
