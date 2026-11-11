import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAutoTextAttachment } from '../useAutoTextAttachment'

const LONG_PASTE = 'x'.repeat(12_001)

/*
 * No window.api here, as with a preload that failed or predates the method: the api proxy still
 * answers every name with a function, so a typeof guard never fired and the paste vanished with
 * nothing said (fix(renderer): ask the preload what it has, not the api proxy).
 */
describe('useAutoTextAttachment without the preload method', () => {
  it('tells the person to restart instead of dropping the long paste', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const setAttachmentError = vi.fn()
    const { result } = renderHook(() =>
      useAutoTextAttachment({
        attachments: [],
        addAttachments: vi.fn(),
        removeAttachment: vi.fn(),
        setAttachmentError,
      }),
    )

    act(() => {
      expect(result.current.checkAndConvertPaste(LONG_PASTE, '')).toBe(true)
    })

    expect(setAttachmentError).toHaveBeenCalledExactlyOnceWith(
      'Attachment conversion is unavailable. Please restart the app.',
    )
    expect(result.current.pendingTextAttachmentChips).toEqual([])
  })
})
