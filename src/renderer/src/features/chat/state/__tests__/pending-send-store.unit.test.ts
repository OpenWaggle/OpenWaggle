import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePendingSendStore } from '../pending-send-store'

const S1 = SessionId('session-1')
const S2 = SessionId('session-2')
const pending = () => usePendingSendStore.getState().bySession

describe('usePendingSendStore', () => {
  beforeEach(() => usePendingSendStore.setState({ bySession: new Map() }))

  it("moves a draft's first send to the Session it created", () => {
    const send = { afterUserMessageId: null }
    usePendingSendStore.getState().begin(null, send)
    usePendingSendStore.getState().adoptDraft(S1)

    expect(pending().get('draft')).toBeUndefined()
    expect(pending().get(String(S1))).toBe(send)
  })

  it('keeps sends of different Sessions apart', () => {
    usePendingSendStore.getState().begin(S1, { afterUserMessageId: 'a' })
    usePendingSendStore.getState().begin(S2, { afterUserMessageId: 'b' })

    expect(pending().get(String(S1))).toEqual({ afterUserMessageId: 'a' })
    expect(pending().get(String(S2))).toEqual({ afterUserMessageId: 'b' })
  })

  it('clears only the exact send, keeping a newer one in its place', () => {
    const first = { afterUserMessageId: 'a' }
    const second = { afterUserMessageId: 'b' }
    usePendingSendStore.getState().begin(S1, first)
    usePendingSendStore.getState().begin(S1, second)

    usePendingSendStore.getState().clearSend(first)
    expect(pending().get(String(S1))).toBe(second)

    usePendingSendStore.getState().clearSend(second)
    expect(pending().get(String(S1))).toBeUndefined()
  })
})
