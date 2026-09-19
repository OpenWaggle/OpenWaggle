import { act, renderHook } from '@testing-library/react'
import { fromAny } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state/composer-store'

const prepareAttachmentsMock = vi.fn()

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    prepareAttachments: (...args: unknown[]) => prepareAttachmentsMock(...args),
  },
}))

import { useFileAttachment } from '../../hooks/useFileAttachment'

function createParams(overrides: Partial<Parameters<typeof useFileAttachment>[0]> = {}) {
  return {
    projectPath: '/test/project',
    attachments: [],
    preparingPendingCount: 0,
    addAttachments: vi.fn(),
    setAttachmentError: vi.fn(),
    onToast: vi.fn(),
    ...overrides,
  }
}

function createDragEvent(files: File[] = []) {
  return fromAny<React.DragEvent, unknown>({
    preventDefault: vi.fn(),
    dataTransfer: {
      types: files.length > 0 ? ['Files'] : [],
      files,
    },
  })
}

function createFile(name: string) {
  return new File(['content'], name)
}

describe('useFileAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useComposerStore.setState(useComposerStore.getInitialState())
  })

  it('starts with isDragOver false', () => {
    const params = createParams()
    const { result } = renderHook(() => useFileAttachment(params))
    expect(result.current.isDragOver).toBe(false)
  })

  it('blocks file selection and drops until the draft context is enabled', async () => {
    const params = { ...createParams(), disabled: true }
    const hook = renderHook((input) => useFileAttachment(input), { initialProps: params })
    const file = createFile('draft.txt')
    const input = fromAny<React.ChangeEvent<HTMLInputElement>, unknown>({
      target: { files: [file], value: 'draft.txt' },
    })
    prepareAttachmentsMock.mockResolvedValue([])

    await act(async () => {
      hook.result.current.handleDragEnter(createDragEvent([file]))
      await hook.result.current.handleDrop(createDragEvent([file]))
      await hook.result.current.handleAttachFiles(input)
    })
    expect(prepareAttachmentsMock).not.toHaveBeenCalled()
    expect(params.addAttachments).not.toHaveBeenCalled()
    expect(hook.result.current.isDragOver).toBe(false)
    expect(input.target.value).toBe('')

    hook.rerender({ ...params, disabled: false })
    await act(async () => hook.result.current.handleDrop(createDragEvent([file])))
    expect(prepareAttachmentsMock).toHaveBeenCalledWith('/test/project', [file])
  })

  it.each(['disabled', 'new-draft'])(
    'does not attach a pending result after %s',
    async (change) => {
      let finish: (attachments: []) => void = () => undefined
      const prepared = [
        {
          id: 'pending',
          kind: 'text' as const,
          name: 'draft.txt',
          path: '/test/project/draft.txt',
          mimeType: 'text/plain',
          sizeBytes: 1,
          extractedText: 'draft',
        },
      ]
      prepareAttachmentsMock.mockImplementation(() =>
        new Promise<[]>((resolve) => {
          finish = resolve
        }).then(() => prepared),
      )
      const params = { ...createParams(), disabled: false }
      const hook = renderHook((input) => useFileAttachment(input), { initialProps: params })
      let pending: Promise<void> | undefined
      act(() => {
        pending = hook.result.current.handleDrop(createDragEvent([createFile('draft.txt')]))
      })
      if (change === 'disabled') hook.rerender({ ...params, disabled: true })
      else act(() => useComposerStore.getState().switchScopedDraftContext('next-draft'))
      await act(async () => {
        finish([])
        await pending
      })
      expect(params.addAttachments).not.toHaveBeenCalled()
    },
  )

  it('clears the drag highlight after a disabled drag and re-enabling', () => {
    const params = { ...createParams(), disabled: true }
    const hook = renderHook((input) => useFileAttachment(input), { initialProps: params })
    act(() => {
      hook.result.current.handleDragEnter(createDragEvent([createFile('draft.txt')]))
      hook.result.current.handleDragLeave(createDragEvent())
    })
    hook.rerender({ ...params, disabled: false })
    act(() => hook.result.current.handleDragEnter(createDragEvent([createFile('draft.txt')])))
    expect(hook.result.current.isDragOver).toBe(true)
    act(() => hook.result.current.handleDragLeave(createDragEvent()))
    expect(hook.result.current.isDragOver).toBe(false)
  })

  it('sets isDragOver on drag enter with files', () => {
    const params = createParams()
    const { result } = renderHook(() => useFileAttachment(params))

    act(() => {
      result.current.handleDragEnter(createDragEvent([createFile('a.txt')]))
    })

    expect(result.current.isDragOver).toBe(true)
  })

  it('clears isDragOver when drag counter reaches zero', () => {
    const params = createParams()
    const { result } = renderHook(() => useFileAttachment(params))

    act(() => {
      result.current.handleDragEnter(createDragEvent([createFile('a.txt')]))
      result.current.handleDragLeave(createDragEvent())
    })

    expect(result.current.isDragOver).toBe(false)
  })

  it('sets error when no project path on drop', async () => {
    const params = createParams({ projectPath: null })
    const { result } = renderHook(() => useFileAttachment(params))

    await act(async () => {
      await result.current.handleDrop(createDragEvent([createFile('a.txt')]))
    })

    expect(params.setAttachmentError).toHaveBeenCalledWith(
      'Select a project before attaching files.',
    )
  })

  it('silently rejects drop when at capacity', async () => {
    const existingAttachments = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      kind: 'text' as const,
      name: `file${String(i)}.txt`,
      path: `/file${String(i)}.txt`,
      mimeType: 'text/plain',
      sizeBytes: 100,
      extractedText: '',
    }))
    const params = createParams({ attachments: existingAttachments })
    const { result } = renderHook(() => useFileAttachment(params))

    expect(result.current.isAtCapacity).toBe(true)

    await act(async () => {
      await result.current.handleDrop(createDragEvent([createFile('new.txt')]))
    })

    expect(prepareAttachmentsMock).not.toHaveBeenCalled()
  })

  it('calls prepareAttachments on valid drop', async () => {
    const prepared = [
      {
        id: '1',
        kind: 'text' as const,
        name: 'test.txt',
        path: '/test/project/test.txt',
        mimeType: 'text/plain',
        sizeBytes: 100,
        extractedText: 'content',
      },
    ]
    prepareAttachmentsMock.mockResolvedValue(prepared)
    const file = createFile('test.txt')
    const params = createParams()
    const { result } = renderHook(() => useFileAttachment(params))

    await act(async () => {
      await result.current.handleDrop(createDragEvent([file]))
    })

    expect(prepareAttachmentsMock).toHaveBeenCalledWith('/test/project', [file])
    expect(params.addAttachments).toHaveBeenCalledWith(prepared)
  })

  it('handles file input change', async () => {
    const prepared = [
      {
        id: '1',
        kind: 'text' as const,
        name: 'doc.pdf',
        path: '/test/project/doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 500,
        extractedText: '',
      },
    ]
    prepareAttachmentsMock.mockResolvedValue(prepared)
    const file = createFile('doc.pdf')
    const params = createParams()
    const { result } = renderHook(() => useFileAttachment(params))

    const inputEvent = fromAny<React.ChangeEvent<HTMLInputElement>, unknown>({
      target: {
        files: [file],
        value: 'something',
      },
    })

    await act(async () => {
      await result.current.handleAttachFiles(inputEvent)
    })

    expect(prepareAttachmentsMock).toHaveBeenCalledWith('/test/project', [file])
    expect(params.addAttachments).toHaveBeenCalledWith(prepared)
    expect(inputEvent.target.value).toBe('')
  })

  it('trims dropped files to remaining capacity', async () => {
    const existingAttachments = Array.from({ length: 3 }, (_, i) => ({
      id: String(i),
      kind: 'text' as const,
      name: `file${String(i)}.txt`,
      path: `/file${String(i)}.txt`,
      mimeType: 'text/plain',
      sizeBytes: 100,
      extractedText: '',
    }))
    prepareAttachmentsMock.mockResolvedValue([])
    const fileA = createFile('a.txt')
    const fileB = createFile('b.txt')
    const fileC = createFile('c.txt')
    const params = createParams({ attachments: existingAttachments })
    const { result } = renderHook(() => useFileAttachment(params))

    // 3 existing + 3 dropped = 6, but max is 5 → only first 2 should be sent
    await act(async () => {
      await result.current.handleDrop(createDragEvent([fileA, fileB, fileC]))
    })

    expect(prepareAttachmentsMock).toHaveBeenCalledWith('/test/project', [fileA, fileB])
  })
})
