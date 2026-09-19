import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerActionStore } from '../../state/composer-action-store'
import { useSessionScopedFilePicker } from '../useSessionScopedFilePicker'

function FilePickerHarness({ sessionId }: { readonly sessionId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  useSessionScopedFilePicker(sessionId, inputRef)
  return <input ref={inputRef} type="file" aria-label="Test attachment picker" />
}

describe('useSessionScopedFilePicker', () => {
  beforeEach(() => {
    useComposerActionStore.setState(useComposerActionStore.getInitialState())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the native input exactly once for the matching session', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    render(<FilePickerHarness sessionId="session-a" />)

    act(() => useComposerActionStore.getState().requestFilePicker('session-a'))

    expect(click).toHaveBeenCalledTimes(1)
    expect(useComposerActionStore.getState().filePickerRequest).toBeNull()
  })

  it('drops a request owned by another session without opening the picker', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    render(<FilePickerHarness sessionId="session-b" />)

    act(() => useComposerActionStore.getState().requestFilePicker('session-a'))

    expect(click).not.toHaveBeenCalled()
    expect(useComposerActionStore.getState().filePickerRequest).toBeNull()
  })
})
