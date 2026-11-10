import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { ScheduledTaskRepository } from '../../ports/scheduled-task-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import {
  changedHeartbeatBoundaryRefusal,
  HEARTBEAT_OWNER_REMEDY,
  heartbeatBoundaryRefusal,
  runsAsAfterUpdate,
} from '../scheduled-task-authority'
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
  target: { kind: 'heartbeat' as const, sessionId: 'session-1', thinkingLevel: 'low' as const },
  stopWhen: 'CI is green.',
  wakeCheck: {
    command: 'gh pr checks',
    onFailure: 'skip' as const,
    approvedCommand: 'gh pr checks',
    pendingSince: null,
  },
}

function runsAs(
  principal: ScheduledTaskPrincipal,
  patch: Parameters<typeof runsAsAfterUpdate>[2],
  task: Parameters<typeof runsAsAfterUpdate>[1] = PROFILE_TASK,
) {
  return Effect.runPromise(
    runsAsAfterUpdate(principal, task, patch).pipe(
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
    expect(await runsAs(owner, { heartbeat: { stopWhen: 'The release is out.' } })).toMatchObject({
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

  it('keeps the limits when an edit sends the work it already has', async () => {
    const kept = {
      creatorCallerId: 'profile:ci',
      authorityLimits: PROFILE_TASK.authorityLimits,
      workByAgent: true,
    }
    // What the app's editor sends when the owner only renames or reschedules a Heartbeat.
    expect(
      await runsAs(owner, {
        name: 'Watch CI',
        schedule: { kind: 'interval', everyMinutes: 15 },
        prompt: PROFILE_TASK.prompt,
        target: { thinkingLevel: 'low', sessionId: 'session-1', kind: 'heartbeat' },
        heartbeat: { stopWhen: 'CI is green.', indefinite: false, idlePauseAfter: 3 },
      }),
    ).toEqual(kept)
    expect(await runsAs(owner, { heartbeat: { stopWhen: '  CI is green.  ' } })).toEqual(kept)
    expect(
      await runsAs(owner, { heartbeat: { wakeCheck: { command: ' gh pr checks ' } } }),
    ).toEqual(kept)
    expect(
      await runsAs(owner, {
        heartbeat: { wakeCheck: { command: 'gh pr checks', onFailure: 'skip' } },
      }),
    ).toEqual(kept)
  })

  it('keeps the limits when an edit clears a stop condition or Wake check the task never had', async () => {
    const task = { ...PROFILE_TASK, stopWhen: null, wakeCheck: null }
    for (const heartbeat of [{ stopWhen: null }, { stopWhen: '  ' }, { wakeCheck: null }]) {
      expect(await runsAs(owner, { heartbeat }, task)).toEqual({
        creatorCallerId: 'profile:ci',
        authorityLimits: PROFILE_TASK.authorityLimits,
        workByAgent: true,
      })
    }
    expect(await runsAs(owner, { heartbeat: { wakeCheck: { command: 'true' } } }, task)).toEqual({
      creatorCallerId: 'profile:ci',
      authorityLimits: null,
      workByAgent: true,
    })
  })

  it('ends the limits when the owner changes the stop condition or the Wake check', async () => {
    for (const heartbeat of [
      { stopWhen: null },
      { stopWhen: 'CI is red.' },
      { wakeCheck: null },
      { wakeCheck: { command: 'gh run list' } },
      { wakeCheck: { command: 'gh pr checks', onFailure: 'wake' as const } },
    ]) {
      expect(await runsAs(owner, { heartbeat })).toEqual({
        creatorCallerId: 'profile:ci',
        authorityLimits: null,
        workByAgent: true,
      })
    }
    expect(
      await runsAs(owner, { target: { kind: 'heartbeat', sessionId: 'session-1' } }),
    ).toMatchObject({ authorityLimits: null })
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

  // It still runs as the profile, so its firings stay held to the Worker limits.
  it('keeps a profile’s task the profile’s work when the person changes it', async () => {
    const person = fromPartial<ScheduledTaskPrincipal>({
      localUser: true,
      creatorCallerId: 'gui:local-user',
      authorityLimits: null,
      creator: { kind: 'local-user', label: 'You' },
    })
    expect(await runsAs(person, { prompt: 'Mine now.' })).toEqual({
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

  // Re-sending the task's own work writes nothing new, so whoever last wrote it still did.
  it('keeps who wrote a task’s work when an edit re-sends the work it already has', async () => {
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
    // What the app's editor sends when only the name or schedule changed.
    const echo = {
      prompt: PROFILE_TASK.prompt,
      target: PROFILE_TASK.target,
      heartbeat: { stopWhen: ' CI is green. ', wakeCheck: { command: 'gh pr checks ' } },
    }

    expect(await runsAs(agent, echo, personTask)).toMatchObject({ workByAgent: false })
    expect(await runsAs(person, echo, { ...personTask, workByAgent: true })).toMatchObject({
      workByAgent: true,
    })
  })

  it('keeps the limits as they are when a limited Session agent re-sends the task’s work', async () => {
    const agent = fromPartial<ScheduledTaskPrincipal>({
      localUser: false,
      creatorCallerId: 'session-agent:session-2:run-1',
      authorityLimits: { ...LIMITS, capabilities: [] },
      creator: { kind: 'session-agent', label: 'Agent', sessionId: 'session-2' },
    })
    // Nothing new to run, so the limits are not narrowed to the agent's, and the result never
    // reaches the Session catalog the fixture leaves empty.
    expect(
      await runsAs(agent, {
        prompt: PROFILE_TASK.prompt,
        target: PROFILE_TASK.target,
        heartbeat: { stopWhen: ' CI is green. ', wakeCheck: { command: 'gh pr checks ' } },
      }),
    ).toEqual({
      creatorCallerId: 'profile:ci',
      authorityLimits: PROFILE_TASK.authorityLimits,
      workByAgent: true,
    })
  })
})

describe('changedHeartbeatBoundaryRefusal', () => {
  it('does not check the boundary again when the target only differs in key order', async () => {
    const reordered = {
      ...PROFILE_TASK,
      target: { thinkingLevel: 'low' as const, sessionId: 'session-1', kind: 'heartbeat' as const },
    }
    expect(
      await Effect.runPromise(
        changedHeartbeatBoundaryRefusal(PROFILE_TASK, reordered).pipe(
          // Reading a boundary would throw: this repository has none.
          Effect.provideService(ScheduledTaskRepository, fromPartial({})),
        ),
      ),
    ).toBeNull()
  })
})

describe('heartbeatBoundaryRefusal', () => {
  function refusal(
    limits: typeof LIMITS | { readonly scope: { readonly projectPaths: string[] } },
    remedy = HEARTBEAT_OWNER_REMEDY,
  ) {
    const everywhere = { reachesEveryProject: true, authorizationCeiling: 'yolo' as const }
    return Effect.runPromise(
      heartbeatBoundaryRefusal({
        ownerCallerId: 'local-user',
        limits: fromPartial({ authorizationCeiling: 'yolo', ...limits }),
        sessionId: 'session-1',
        remedy,
      }).pipe(
        Effect.provideService(
          ScheduledTaskRepository,
          fromPartial({
            sessionAuthorityBoundary: () => Effect.succeed(everywhere),
            callerAuthorityBoundary: () => Effect.succeed(everywhere),
          }),
        ),
      ),
    )
  }

  // A Heartbeat keeps its Session, so the owner is told only what they can change.
  it('tells the owner of a stopped Heartbeat how to run it with their own access', async () => {
    expect(await refusal(LIMITS)).toBe(
      "This Heartbeat runs within an agent's access, which has to ask for approval, but its Session can run in YOLO mode. Its owner can change its prompt, stop condition or Wake check, then turn it on again, to run it with their own access.",
    )
    expect(await refusal({ scope: { projectPaths: ['/work/app'] } }, 'Ask its owner.')).toBe(
      "This Heartbeat runs within an agent's access, which does not reach every project, but its Session does. Ask its owner.",
    )
  })
})
