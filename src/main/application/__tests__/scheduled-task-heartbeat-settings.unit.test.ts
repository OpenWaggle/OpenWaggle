import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_HEARTBEAT_FIELDS, heartbeatFieldsFor } from '../scheduled-task-heartbeat-settings'
import { installScheduledTaskHooks } from '../scheduled-task-hooks'
import type { ScheduledTaskPrincipal } from '../scheduled-task-principal'

let release: (() => void) | undefined

afterEach(() => {
  release?.()
  release = undefined
})

const USER = fromPartial<ScheduledTaskPrincipal>({ localUser: true })
const AGENT = fromPartial<ScheduledTaskPrincipal>({ localUser: false })

function fields(
  principal: ScheduledTaskPrincipal,
  current = DEFAULT_HEARTBEAT_FIELDS,
  command = 'gh pr checks 42',
) {
  return Effect.runPromise(
    heartbeatFieldsFor({
      principal,
      current,
      settings: { wakeCheck: { command } },
      sessionId: 'session-1',
      runsAs: 'session-agent:session-1',
      now: 7,
    }),
  )
}

describe('Wake check approval (#388)', () => {
  it('is approved by the user setting it, and pending for an agent in an Ask for Approval Session', async () => {
    release = installScheduledTaskHooks({
      sessionAuthorizationMode: () => Effect.succeed('ask-for-approval'),
    })
    expect((await fields(USER)).wakeCheck).toEqual({
      command: 'gh pr checks 42',
      onFailure: 'wake',
      approvedCommand: 'gh pr checks 42',
      pendingSince: null,
    })
    const pending = await fields(AGENT)
    expect(pending.wakeCheck).toMatchObject({ approvedCommand: null, pendingSince: 7 })
    // The same command again keeps the approval state; a changed one asks again.
    const approved = {
      ...pending,
      wakeCheck: {
        command: 'gh pr checks 42',
        onFailure: 'wake' as const,
        approvedCommand: 'gh pr checks 42',
        pendingSince: null,
      },
    }
    expect((await fields(AGENT, approved)).wakeCheck).toMatchObject({ pendingSince: null })
    expect((await fields(AGENT, approved, 'gh pr checks 43')).wakeCheck).toMatchObject({
      approvedCommand: 'gh pr checks 42',
      pendingSince: 7,
    })
  })

  it('needs no approval in a YOLO Session', async () => {
    release = installScheduledTaskHooks({ sessionAuthorizationMode: () => Effect.succeed('yolo') })
    expect((await fields(AGENT)).wakeCheck).toMatchObject({
      approvedCommand: null,
      pendingSince: null,
    })
  })
})
