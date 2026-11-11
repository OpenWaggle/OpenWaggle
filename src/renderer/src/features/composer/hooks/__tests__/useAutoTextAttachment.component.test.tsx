import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAutoTextAttachment } from '../useAutoTextAttachment'

const LONG_PASTE = 'x'.repeat(12_001)

/*
 * No window.api here, as with a preload that failed to load: the api proxy rejects the call. The
 * intercepted paste never reached the editor, so it must not vanish with nothing said, which is
 * what an earlier capability guard let happen (fix(renderer): ask the preload what it has, not the
 * api proxy). Any rejected conversion now says so.
 */
describe('useAutoTextAttachment when the conversion fails', () => {
  it('tells the person the long paste was not attached instead of dropping it silently', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setAttachmentError = vi.fn()
    const addAttachments = vi.fn()
    const { result } = renderHook(() =>
      useAutoTextAttachment({
        attachments: [],
        addAttachments,
        removeAttachment: vi.fn(),
        setAttachmentError,
      }),
    )

    act(() => {
      expect(result.current.checkAndConvertPaste(LONG_PASTE, '')).toBe(true)
    })

    await waitFor(() => {
      expect(setAttachmentError).toHaveBeenCalledExactlyOnceWith(
        'Could not turn the long paste into an attachment. Paste it again, or attach it as a file.',
      )
    })
    expect(result.current.pendingTextAttachmentChips).toEqual([])
    expect(addAttachments).not.toHaveBeenCalled()
  })
})
