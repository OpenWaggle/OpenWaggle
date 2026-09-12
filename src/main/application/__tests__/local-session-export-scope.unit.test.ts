import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { scopeNamedProfileExport } from '../local-session-command-dispatcher'

describe('named-profile Session export scope', () => {
  let root = ''
  let workspace = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-profile-export-'))
    workspace = path.join(root, 'workspace')
    await fs.mkdir(workspace)
    workspace = await fs.realpath(workspace)
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function caller(
    scope: LocalSessionProfileScope = {
      sessionIds: ['session-1'],
      exportRoots: [workspace],
    },
  ): LocalSessionCallerIdentity {
    return {
      callerId: 'profile:exporter',
      profileAuthority: {
        profileId: 'exporter',
        profileName: 'exporter',
        capabilities: ['sessions:export'],
        scope,
        authorizationCeiling: 'ask-for-approval',
      },
    }
  }

  function payload(
    destinationPath: string,
    destinationRoot?: string,
    resources?: readonly { readonly kind: 'workspace-file'; readonly path: string }[],
  ): LocalSessionCommandPayload {
    return {
      contract: 'session-control-v2',
      request: {
        contractVersion: 2,
        requestId: 'request-export',
        idempotencyKey: 'export-once',
        command: {
          operation: 'export-create',
          sessionId: 'session-1',
          format: resources ? 'bundle' : 'jsonl',
          destinationPath,
          ...(resources ? { resources } : {}),
          ...(destinationRoot ? { destinationRoot } : {}),
        },
      },
    }
  }

  function layer() {
    return Layer.succeed(SessionAuthorizationTargetRepository, {
      resolve: () =>
        Effect.succeed({
          sessionId: 'session-1',
          projectPath: workspace,
          workingPath: workspace,
          hiveRootSessionId: 'session-1',
          authorizationCeiling: 'ask-for-approval' as const,
        }),
      resolveDelegation: () => Effect.die('unused'),
      listLiveDerivedAuthorities: () => Effect.succeed([]),
    })
  }

  it('injects a Host-derived root and ignores a forged wire root', async () => {
    const destinationPath = path.join(workspace, 'exports', 'session.jsonl')
    const scoped = await Effect.runPromise(
      scopeNamedProfileExport(caller(), payload(destinationPath, root)).pipe(
        Effect.provide(layer()),
      ),
    )

    expect(scoped).toMatchObject({
      request: {
        command: {
          destinationPath: path.join(await fs.realpath(workspace), 'exports', 'session.jsonl'),
          destinationRoot: await fs.realpath(workspace),
        },
      },
    })
  })

  it('allows a Session worker to bundle resources from its exact granted workspace root', async () => {
    const destinationPath = path.join(workspace, 'exports', 'session.zip')
    const worker: LocalSessionCallerIdentity = {
      ...caller(),
      callerId: 'session-agent:worker-session',
    }

    const scoped = await Effect.runPromise(
      scopeNamedProfileExport(
        worker,
        payload(destinationPath, undefined, [{ kind: 'workspace-file', path: 'reports/qa.md' }]),
      ).pipe(Effect.provide(layer())),
    )

    expect(scoped).toMatchObject({
      request: {
        command: {
          destinationRoot: workspace,
          resources: [{ kind: 'workspace-file', path: 'reports/qa.md' }],
        },
      },
    })
  })

  it('rejects omitted or forged roots when the destination is outside the Session workspace', async () => {
    const outside = path.join(root, 'outside', 'stolen.jsonl')

    await expect(
      Effect.runPromise(
        scopeNamedProfileExport(caller(), payload(outside)).pipe(Effect.provide(layer())),
      ),
    ).rejects.toThrow('outside the granted filesystem scope')
    await expect(
      Effect.runPromise(
        scopeNamedProfileExport(caller(), payload(outside, root)).pipe(Effect.provide(layer())),
      ),
    ).rejects.toThrow('outside the granted filesystem scope')
  })

  it('rejects a session-only profile instead of deriving filesystem authority from visibility', async () => {
    const destination = path.join(workspace, 'package.json')
    await fs.writeFile(destination, '{"private":true}', 'utf8')

    await expect(
      Effect.runPromise(
        scopeNamedProfileExport(
          caller({ sessionIds: ['session-1'] }),
          payload(destination, workspace),
        ).pipe(Effect.provide(layer())),
      ),
    ).rejects.toThrow('explicit filesystem workspace grant')
    await expect(fs.readFile(destination, 'utf8')).resolves.toBe('{"private":true}')
  })

  it('rejects an export root retargeted through a symlink after the grant', async () => {
    if (process.platform === 'win32') return
    const authorized = path.join(root, 'workspace-authorized')
    const outside = path.join(root, 'outside-retarget')
    await fs.mkdir(outside)
    await fs.rename(workspace, authorized)
    await fs.symlink(outside, workspace)

    await expect(
      Effect.runPromise(
        scopeNamedProfileExport(
          caller({ sessionIds: ['session-1'], exportRoots: [workspace] }),
          payload(path.join(workspace, 'package.json')),
        ).pipe(Effect.provide(layer())),
      ),
    ).rejects.toThrow('changed after it was granted')
  })
})
