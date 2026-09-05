import type { PreparedAttachment } from '@shared/types/agent'
import { act, renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import type { LexicalEditor } from 'lexical'
import type { RefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '../../state/composer-store'
import { useComposerSubmission } from '../useComposerSubmission'

const { clearEditor } = vi.hoisted(() => ({ clearEditor: vi.fn() }))

vi.mock('../../lib/lexical-utils', () => ({ clearEditor }))

vi.mock('@/features/providers/hooks', () => ({
  useSelectedModelThinkingLevel: () => ({ effectiveThinkingLevel: 'off' }),
}))

vi.mock('../useComposerModel', () => ({
  useComposerModel: () => ({ model: 'openai/test-model', isSessionModel: true }),
}))

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<undefined>((resolvePromise, rejectPromise) => {
    resolve = () => resolvePromise(undefined)
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderSubmission(
  onEnqueue: () => Promise<boolean | undefined>,
  options: {
    readonly isLoading?: boolean
    readonly onSend?: () => Promise<void> | void | false
  } = {},
) {
  const editorRef: RefObject<LexicalEditor | null> = { current: null }
  return renderHook(() =>
    useComposerSubmission({
      onSend: options.onSend ?? vi.fn(),
      onEnqueue,
      isLoading: options.isLoading ?? true,
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
    clearEditor.mockReset()
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

  it('preserves the draft when the renderer send gate blocks the Follow-up', async () => {
    const { result } = renderSubmission(async () => false)

    let submission!: Promise<boolean>
    act(() => {
      submission = Promise.resolve(result.current.handleSubmit())
    })

    await expect(submission).resolves.toBe(false)
    expect(useComposerStore.getState().input).toBe('keep this draft')
    expect(useComposerStore.getState().attachments).toHaveLength(1)
    expect(useComposerStore.getState().promptHistory).not.toContain('keep this draft')
  })

  it('preserves the draft when the renderer send gate blocks a direct send', async () => {
    const { result } = renderSubmission(async () => true, {
      isLoading: false,
      onSend: () => false,
    })

    expect(result.current.handleSubmit()).toBe(false)
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

  it('deduplicates repeated submission while the same Follow-up is pending', async () => {
    const request = deferred()
    const onEnqueue = vi.fn(() => request.promise)
    const { result } = renderSubmission(onEnqueue)

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = Promise.resolve(result.current.handleSubmit())
      second = Promise.resolve(result.current.handleSubmit())
    })

    expect(onEnqueue).toHaveBeenCalledOnce()
    await act(async () => {
      request.resolve()
      await Promise.all([first, second])
    })
    expect(useComposerStore.getState().promptHistory).toEqual(['keep this draft'])
  })

  it('unlocks a rejected draft for an explicit retry', async () => {
    const firstRequest = deferred()
    const onEnqueue = vi
      .fn<() => Promise<undefined>>()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockResolvedValueOnce(undefined)
    const { result } = renderSubmission(onEnqueue)

    let first!: Promise<boolean>
    act(() => {
      first = Promise.resolve(result.current.handleSubmit())
    })
    await act(async () => {
      firstRequest.reject(new Error('Host unavailable'))
      await first
    })
    await act(async () => {
      await result.current.handleSubmit()
    })

    expect(onEnqueue).toHaveBeenCalledTimes(2)
    expect(useComposerStore.getState().input).toBe('')
  })

  it('clears an accepted originating draft after navigation without touching the active draft', async () => {
    const request = deferred()
    const { result } = renderSubmission(() => request.promise)

    let submission!: Promise<boolean>
    act(() => {
      submission = Promise.resolve(result.current.handleSubmit())
      useComposerStore.getState().switchScopedDraftContext('session:session-b')
      useComposerStore.getState().setInput('session B draft')
    })
    await act(async () => {
      request.resolve()
      await submission
    })

    expect(useComposerStore.getState().input).toBe('session B draft')
    expect(useComposerStore.getState().getScopedDraft('session:session-a')).toBeNull()
    act(() => {
      useComposerStore.getState().switchScopedDraftContext('session:session-a')
    })
    expect(useComposerStore.getState().input).toBe('')
    expect(useComposerStore.getState().attachments).toEqual([])
  })

  it('deduplicates across composer remounts and clears the current editor after acknowledgement', async () => {
    const request = deferred()
    const onEnqueue = vi.fn(() => request.promise)
    const firstHook = renderSubmission(onEnqueue)
    let first!: Promise<boolean>
    act(() => {
      first = Promise.resolve(firstHook.result.current.handleSubmit())
    })
    firstHook.unmount()

    const remountedEditor = fromPartial<LexicalEditor>({})
    act(() => useComposerStore.getState().setLexicalEditor(remountedEditor))
    const secondHook = renderSubmission(onEnqueue)
    let second!: Promise<boolean>
    act(() => {
      second = Promise.resolve(secondHook.result.current.handleSubmit())
    })

    expect(onEnqueue).toHaveBeenCalledOnce()
    await act(async () => {
      request.resolve()
      await Promise.all([first, second])
    })
    expect(useComposerStore.getState().input).toBe('')
    expect(clearEditor).toHaveBeenCalledWith(remountedEditor)
    secondHook.unmount()
  })
})
