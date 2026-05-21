import { act, renderHook } from '@testing-library/react'
import { fromAny } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  })

  it('starts with isDragOver false', () => {
    const params = createParams()
    const { result } = renderHook(() => useFileAttachment(params))
    expect(result.current.isDragOver).toBe(false)
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
