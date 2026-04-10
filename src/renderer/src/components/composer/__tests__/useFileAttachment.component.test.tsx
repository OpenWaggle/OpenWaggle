import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prepareAttachmentsMock = vi.fn()
const getFilePathMock = vi.fn()

vi.mock('@/lib/ipc', () => ({
  api: {
    prepareAttachments: (...args: unknown[]) => prepareAttachmentsMock(...args),
    getFilePath: (file: File) => getFilePathMock(file),
  },
}))

import { useFileAttachment } from '../useFileAttachment'

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

function createDragEvent(files: File[] = []): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      types: files.length > 0 ? ['Files'] : [],
      files,
    },
  } as unknown as React.DragEvent
}

function createFileWithPath(name: string, path: string): File {
  const file = new File(['content'], name)
  // Mock getFilePath to return the given path for this file
  getFilePathMock.mockImplementation((f: File) => (f === file ? path : ''))
  return file
}

describe('useFileAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getFilePathMock.mockReturnValue('')
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
      result.current.handleDragEnter(createDragEvent([createFileWithPath('a.txt', '/a.txt')]))
    })

    expect(result.current.isDragOver).toBe(true)
  })

  it('clears isDragOver when drag counter reaches zero', () => {
    const params = createParams()
    const { result } = renderHook(() => useFileAttachment(params))

    act(() => {
      result.current.handleDragEnter(createDragEvent([createFileWithPath('a.txt', '/a.txt')]))
      result.current.handleDragLeave(createDragEvent())
    })

    expect(result.current.isDragOver).toBe(false)
  })

  it('sets error when no project path on drop', async () => {
    const params = createParams({ projectPath: null })
    const { result } = renderHook(() => useFileAttachment(params))

    await act(async () => {
      await result.current.handleDrop(createDragEvent([createFileWithPath('a.txt', '/a.txt')]))
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
      await result.current.handleDrop(createDragEvent([createFileWithPath('new.txt', '/new.txt')]))
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
    const params = createParams()
    const { result } = renderHook(() => useFileAttachment(params))

    await act(async () => {
      await result.current.handleDrop(
        createDragEvent([createFileWithPath('test.txt', '/test/project/test.txt')]),
      )
    })

    expect(prepareAttachmentsMock).toHaveBeenCalledWith('/test/project', ['/test/project/test.txt'])
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
    const params = createParams()
    const { result } = renderHook(() => useFileAttachment(params))

    const inputEvent = {
      target: {
        files: [createFileWithPath('doc.pdf', '/test/project/doc.pdf')],
        value: 'something',
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>

    await act(async () => {
      await result.current.handleAttachFiles(inputEvent)
    })

    expect(prepareAttachmentsMock).toHaveBeenCalledWith('/test/project', ['/test/project/doc.pdf'])
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
    const fileA = createFileWithPath('a.txt', '/a.txt')
    const fileB = new File(['content'], 'b.txt')
    const fileC = new File(['content'], 'c.txt')
    // getFilePath returns path for all files
    getFilePathMock.mockImplementation((f: File) => {
      if (f === fileA) return '/a.txt'
      if (f === fileB) return '/b.txt'
      if (f === fileC) return '/c.txt'
      return ''
    })
    const params = createParams({ attachments: existingAttachments })
    const { result } = renderHook(() => useFileAttachment(params))

    // 3 existing + 3 dropped = 6, but max is 5 → only first 2 should be sent
    await act(async () => {
      await result.current.handleDrop(createDragEvent([fileA, fileB, fileC]))
    })

    expect(prepareAttachmentsMock).toHaveBeenCalledWith('/test/project', ['/a.txt', '/b.txt'])
  })
})
