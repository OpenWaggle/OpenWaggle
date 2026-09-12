import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { canonicalizeNamedProfileProjectPayload } from '../local-session-command-dispatcher'
import { refreshNamedProfileCaller } from '../local-session-derived-authority'

describe('named-profile project root retargeting', () => {
  let root = ''

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true })
  })

  it('denies launch when a granted canonical project path is retargeted by symlink', async () => {
    if (process.platform === 'win32') return
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-project-retarget-'))
    const project = path.join(root, 'project')
    const displaced = path.join(root, 'project-authorized')
    const outside = path.join(root, 'sensitive-repository')
    await Promise.all([fs.mkdir(project), fs.mkdir(outside)])
    const caller = {
      callerId: 'profile:launcher',
      profileAuthority: {
        profileId: 'launcher',
        profileName: 'launcher',
        capabilities: ['sessions:create', 'sessions:start'] as const,
        scope: { projectPaths: [await fs.realpath(project)] },
        authorizationCeiling: 'ask-for-approval' as const,
      },
    }
    await fs.rename(project, displaced)
    await fs.symlink(outside, project)
    const payload: LocalSessionCommandPayload = {
      contract: 'session-lifecycle-v2',
      request: {
        contractVersion: 2,
        requestId: 'launch-retarget',
        idempotencyKey: 'launch-retarget-once',
        command: {
          operation: 'launch',
          projectPath: project,
          objective: 'Do not reach the retargeted repository',
          attachmentIds: [],
        },
      },
    }
    const layer = Layer.merge(
      Layer.succeed(SessionAuthorizationTargetRepository, {
        resolve: () => Effect.die('unused'),
        resolveDelegation: () => Effect.die('unused'),
        listLiveDerivedAuthorities: () => Effect.succeed([]),
      }),
      Layer.succeed(LocalSessionProfileRepository, {
        list: () => Effect.succeed([]),
        findForAuthentication: () => Effect.succeed(null),
        findById: () =>
          Effect.succeed({
            id: 'launcher',
            name: 'launcher',
            capabilities: ['sessions:create', 'sessions:start'] as const,
            scope: caller.profileAuthority.scope,
            authorizationCeiling: 'ask-for-approval' as const,
            credentialVerifier: 'test-only-verifier',
            revokedAt: null,
          }),
        recordAuthentication: () => Effect.void,
        executeManagement: () => Effect.die('unused'),
      }),
    )

    await expect(
      Effect.runPromise(refreshNamedProfileCaller(caller).pipe(Effect.provide(layer))),
    ).rejects.toThrow('changed after it was granted')

    const canonical = await Effect.runPromise(
      canonicalizeNamedProfileProjectPayload(caller, payload),
    )
    expect(canonical).toMatchObject({
      request: { command: { projectPath: await fs.realpath(outside) } },
    })
  })
})
