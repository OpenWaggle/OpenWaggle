import { SessionId } from '@shared/types/brand'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionResourceOwnerActivation } from '../useSessionResourceOwnerActivation'

const activateSessionResourceOwner = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { activateSessionResourceOwner },
}))

function Harness({ sessionId }: { readonly sessionId: ReturnType<typeof SessionId> | null }) {
  useSessionResourceOwnerActivation(sessionId)
  return null
}

describe('useSessionResourceOwnerActivation', () => {
  beforeEach(() => activateSessionResourceOwner.mockReset())

  it('revokes the old owner before activating a newly displayed Session', () => {
    const view = render(<Harness sessionId={SessionId('session-a')} />)
    view.rerender(<Harness sessionId={SessionId('session-b')} />)
    view.unmount()

    expect(activateSessionResourceOwner.mock.calls).toEqual([
      [SessionId('session-a')],
      [null],
      [SessionId('session-b')],
      [null],
    ])
  })
})
