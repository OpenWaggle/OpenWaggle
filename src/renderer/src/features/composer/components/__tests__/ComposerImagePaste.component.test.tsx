import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { useComposerStore } from '../../state/composer-store'
import { Composer } from '../Composer'

const apiMock = vi.hoisted(() => ({
  prepareAttachments: vi.fn(),
  prepareImageAttachment: vi.fn(),
  readClipboardImage: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
    getDefaultThinkingLevel: vi.fn().mockResolvedValue('medium'),
    listWagglePresets: vi.fn().mockResolvedValue([]),
    listExtensionContributions: vi.fn().mockResolvedValue({ projectPaths: [], entries: [] }),
    prepareAttachments: (...args: unknown[]) => apiMock.prepareAttachments(...args),
    prepareImageAttachment: (...args: unknown[]) => apiMock.prepareImageAttachment(...args),
    readClipboardImage: (...args: unknown[]) => apiMock.readClipboardImage(...args),
  }),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/features/sessions/hooks', () => ({ useProject: () => ({ projectPath: '/repo' }) }))

function screenshotBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47])
}

function preparedImage(name = 'pasted-image.png') {
  return {
    id: 'session-input-1',
    kind: 'image' as const,
    origin: 'pasted-image' as const,
    name,
    path: `/tmp/prepared/${name}`,
    mimeType: 'image/png',
    sizeBytes: 4,
    extractedText: '',
  }
}

interface ClipboardPayload {
  readonly files: readonly File[]
  readonly text: string
}

/** jsdom has no ClipboardEvent, so the test gives one the shape Chromium uses. */
function pasteIntoComposer(payload: ClipboardPayload) {
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: payload.files,
      getData: (type: string) => (type === 'text/plain' ? payload.text : ''),
      items: payload.files.map((file) => ({
        getAsFile: () => file,
        kind: 'file',
        type: file.type,
      })),
      types: payload.text ? ['text/plain'] : ['Files'],
    },
  })
  fireEvent(screen.getByRole('textbox', { name: 'Message input' }), event)
}

function renderComposer() {
  renderWithQueryClient(
    <Composer onSend={vi.fn()} onEnqueue={vi.fn()} onCancel={vi.fn()} isLoading={false} />,
  )
}

describe('pasting an image into the composer', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
    if (typeof globalThis.ClipboardEvent === 'undefined') {
      Object.defineProperty(globalThis, 'ClipboardEvent', {
        configurable: true,
        value: class extends Event {},
      })
    }
  })

  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    vi.clearAllMocks()
    apiMock.readClipboardImage.mockResolvedValue({
      bytes: screenshotBytes(),
      mimeType: 'image/png',
    })
    apiMock.prepareImageAttachment.mockResolvedValue(preparedImage())
  })

  it('attaches a screenshot that exists only on the clipboard', async () => {
    renderComposer()

    pasteIntoComposer({ files: [], text: '' })

    await waitFor(() => expect(apiMock.readClipboardImage).toHaveBeenCalled())
    expect(apiMock.prepareImageAttachment).toHaveBeenCalledWith(
      screenshotBytes(),
      'pasted-image.png',
      'image/png',
    )
    await waitFor(() => {
      expect(useComposerStore.getState().attachments.map(({ name }) => name)).toEqual([
        'pasted-image.png',
      ])
    })
  })

  it('leaves text pasted beside an image to the editor', async () => {
    renderComposer()

    pasteIntoComposer({ files: [], text: 'pasted words' })

    await waitFor(() => expect(useComposerStore.getState().input).toBe('pasted words'))
    expect(apiMock.readClipboardImage).not.toHaveBeenCalled()
    expect(apiMock.prepareImageAttachment).not.toHaveBeenCalled()
  })

  it('attaches files the clipboard carries instead of reading an image', async () => {
    apiMock.prepareAttachments.mockResolvedValue([
      { attachment: preparedImage('shot.png'), fileIndex: 0 },
    ])
    renderComposer()
    const file = new File([screenshotBytes()], 'shot.png', { type: 'image/png' })

    pasteIntoComposer({ files: [file], text: '' })

    await waitFor(() => expect(apiMock.prepareAttachments).toHaveBeenCalledWith('/repo', [file]))
    expect(apiMock.readClipboardImage).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(useComposerStore.getState().attachments.map(({ name }) => name)).toEqual(['shot.png'])
    })
  })
})
