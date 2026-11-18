import { RunId, SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  forgetRefusedContinuation,
  recordRefusedContinuation,
  refusedContinuationFor,
} from '../pi-session-refused-continuations'

const SESSION = SessionId('session-refused')
const HOLDER = RunId('run-holder')
const LATER = RunId('run-later')

function refuse() {
  recordRefusedContinuation(SESSION, {
    runId: HOLDER,
    state: fromPartial({}),
    snapshot: fromPartial({}),
  })
}

describe('refused Pi continuations', () => {
  it('are for the Run that held the Session', () => {
    refuse()

    expect(refusedContinuationFor(SESSION, HOLDER)?.runId).toBe(HOLDER)
    forgetRefusedContinuation(SESSION)
  })

  it('are dropped when another Run asks for them', () => {
    refuse()

    expect(refusedContinuationFor(SESSION, LATER)).toBeUndefined()
    expect(refusedContinuationFor(SESSION, HOLDER)).toBeUndefined()
  })

  it('go when the holding Run settles, but not when another one does', () => {
    refuse()

    forgetRefusedContinuation(SESSION, LATER)
    expect(refusedContinuationFor(SESSION, HOLDER)).toBeDefined()
    forgetRefusedContinuation(SESSION, HOLDER)
    expect(refusedContinuationFor(SESSION, HOLDER)).toBeUndefined()
  })

  it('go when the user changes a setting', () => {
    refuse()

    forgetRefusedContinuation(SESSION)

    expect(refusedContinuationFor(SESSION, HOLDER)).toBeUndefined()
  })
})
