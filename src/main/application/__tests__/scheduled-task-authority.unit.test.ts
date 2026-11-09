import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { runsAsAfterUpdate } from '../scheduled-task-authority'
import type { ScheduledTaskPrincipal } from '../scheduled-task-principal'

const LIMITS = {
  capabilities: ['sessions:read'] as const,
  scope: { all: true as const },
  authorizationCeiling: 'ask-for-approval' as const,
}

const PROFILE_TASK = {
  ownerKey: 'profile:ci',
  creatorCallerId: 'profile:ci',
  authorityLimits: { ...LIMITS, capabilities: [...LIMITS.capabilities] },
  workByAgent: true,
  prompt: 'Triage the new errors.',
  target: { kind: 'heartbeat' as const, sessionId: 'session-1' },
}

function runsAs(principal: ScheduledTaskPrincipal, patch: Parameters<typeof runsAsAfterUpdate>[2]) {
  return Effect.runPromise(
    runsAsAfterUpdate(principal, PROFILE_TASK, patch).pipe(
      // The branches under test read no Session catalog.
      Effect.provideService(SessionAuthorizationTargetRepository, fromPartial({})),
    ),
  )
}

describe('runsAsAfterUpdate', () => {
  const owner = fromPartial<ScheduledTaskPrincipal>({
    localUser: false,
    creatorCallerId: 'profile:ci',
    authorityLimits: null,
    creator: { kind: 'profile', label: 'CI' },
  })

  it('gives a CLI client profile its whole authority back once it changes its own task’s work', async () => {
    expect(await runsAs(owner, { prompt: 'Something else.' })).toEqual({
      creatorCallerId: 'profile:ci',
      authorityLimits: null,
      workByAgent: true,
    })
    expect(await runsAs(owner, { heartbeat: { stopWhen: 'CI is green.' } })).toMatchObject({
      authorityLimits: null,
    })
  })

  it('keeps the limits when the task is only paused or rescheduled', async () => {
    expect(await runsAs(owner, { enabled: false })).toEqual({
      creatorCallerId: 'profile:ci',
      authorityLimits: PROFILE_TASK.authorityLimits,
      workByAgent: true,
    })
  })

  it('keeps the limits when an unrestricted Session agent changes the task’s work', async () => {
    const agent = fromPartial<ScheduledTaskPrincipal>({
      localUser: false,
      creatorCallerId: 'profile:ci',
      authorityLimits: null,
      creator: { kind: 'session-agent', label: 'Agent', sessionId: 'session-2' },
    })
    expect(await runsAs(agent, { heartbeat: { stopWhen: 'Never.' } })).toEqual({
      creatorCallerId: 'profile:ci',
      authorityLimits: PROFILE_TASK.authorityLimits,
      workByAgent: true,
    })
  })

  // Its firings are then the agent's, held to the Worker limits though they run as the person.
  it('marks the person’s task as an agent’s work once a Session agent changes it, and back', async () => {
    const personTask = {
      ...PROFILE_TASK,
      ownerKey: 'local-user',
      creatorCallerId: 'gui:local-user',
      authorityLimits: null,
      workByAgent: false,
    }
    const agent = fromPartial<ScheduledTaskPrincipal>({
      localUser: false,
      creatorCallerId: 'gui:local-user',
      authorityLimits: null,
      creator: { kind: 'session-agent', label: 'Agent', sessionId: 'session-2' },
    })
    const person = fromPartial<ScheduledTaskPrincipal>({
      localUser: true,
      creatorCallerId: 'gui:local-user',
      authorityLimits: null,
      creator: { kind: 'local-user', label: 'You' },
    })
    const edit = (principal: ScheduledTaskPrincipal, task: typeof personTask) =>
      Effect.runPromise(
        runsAsAfterUpdate(principal, task, { prompt: 'Something else.' }).pipe(
          Effect.provideService(SessionAuthorizationTargetRepository, fromPartial({})),
        ),
      )

    expect(await edit(agent, personTask)).toMatchObject({ workByAgent: true })
    expect(await edit(person, { ...personTask, workByAgent: true })).toMatchObject({
      workByAgent: false,
    })
  })
})
