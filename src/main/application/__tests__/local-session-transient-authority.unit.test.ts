import fs from 'node:fs'
import os from 'node:os'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { SessionQueryResponse } from '@shared/types/session-query'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import {
  SessionQueryRepository,
  type SessionQueryRepositoryShape,
} from '../../ports/session-query-repository'
import { SettingsService } from '../../services/settings-service'
import {
  authorizeLocalSessionCommand,
  refreshNamedProfileCaller,
} from '../local-session-command-authorization'
import { dispatchSessionRepositoryQuery } from '../local-session-query-dispatcher'

const WORKSPACE_ROOT = fs.realpathSync(os.tmpdir())
const PROJECT_PATH = WORKSPACE_ROOT

const transientCaller: LocalSessionCallerIdentity = {
  callerId: 'transient-mcp:workspace-reader',
  profileAuthority: {
    profileId: 'mcp:workspace-reader',
    profileName: 'workspace-reader',
    capabilities: ['sessions:discover', 'sessions:read'],
    scope: { workspaceRoots: [WORKSPACE_ROOT] },
    authorizationCeiling: 'ask-for-approval',
  },
  baseProfileScope: { workspaceRoots: [WORKSPACE_ROOT] },
}

function searchPayload(projectPath?: string) {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: 2,
      requestId: 'workspace-search',
      query: {
        operation: 'search',
        query: 'private marker',
        limit: 10,
        searchScope: 'full-transcript',
        ...(projectPath ? { projectPath } : {}),
      },
    },
  } as const
}

function emptySearchResponse(): SessionQueryResponse {
  return {
    contractVersion: 2,
    requestId: 'workspace-search',
    outcome: {
      operation: 'search',
      sessions: [],
      requestedSearchMode: 'lexical',
      searchBackend: 'lexical',
      discoveryWindow: { size: 0, truncated: false, expiresAt: 1 },
    },
  }
}

function testLayer(repository: SessionQueryRepositoryShape) {
  const resolveWorkspaceProjectPaths = vi.fn(() => Effect.succeed([PROJECT_PATH]))
  const layer = Layer.mergeAll(
    Layer.succeed(LocalSessionProfileRepository, {
      list: () => Effect.succeed([]),
      findForAuthentication: () => Effect.succeed(null),
      findById: () => Effect.succeed(null),
      recordAuthentication: () => Effect.void,
      executeManagement: () => Effect.die('Profile management is not used in this test.'),
    }),
    Layer.succeed(SessionAuthorizationTargetRepository, {
      resolveWorkspaceProjectPaths,
      resolve: (sessionId) =>
        Effect.succeed({
          sessionId,
          projectPath: PROJECT_PATH,
          hiveRootSessionId: sessionId,
          authorizationCeiling: 'ask-for-approval' as const,
        }),
      resolveDelegation: (delegationId) =>
        Effect.succeed({
          sessionId: delegationId,
          projectPath: PROJECT_PATH,
          hiveRootSessionId: delegationId,
          authorizationCeiling: 'ask-for-approval' as const,
        }),
      listLiveDerivedAuthorities: () => Effect.succeed([]),
    }),
    Layer.succeed(SessionQueryRepository, repository),
    Layer.succeed(SettingsService, {
      get: () => Effect.succeed(DEFAULT_SETTINGS),
      update: () => Effect.void,
      initialize: () => Effect.void,
      flushForTests: () => Effect.void,
    }),
  )
  return { layer, resolveWorkspaceProjectPaths }
}

describe('Local Session transient MCP authority', () => {
  it('expands canonical workspace projects before executing a repository query', async () => {
    const execute = vi.fn(() => Effect.succeed(emptySearchResponse()))
    const { layer, resolveWorkspaceProjectPaths } = testLayer({ execute })

    await Effect.runPromise(
      Effect.gen(function* () {
        const payload = searchPayload()
        const caller = yield* refreshNamedProfileCaller(transientCaller)
        yield* authorizeLocalSessionCommand({ caller, payload })
        return yield* dispatchSessionRepositoryQuery(caller, payload)
      }).pipe(Effect.provide(layer)),
    )

    expect(resolveWorkspaceProjectPaths).toHaveBeenCalledWith([WORKSPACE_ROOT])
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        callerId: 'transient-mcp:workspace-reader',
        authority: expect.objectContaining({
          capabilities: ['sessions:discover', 'sessions:read'],
          scope: expect.objectContaining({ projectPaths: [PROJECT_PATH] }),
        }),
      }),
    )
  })

  it('rejects an unauthorized project before repository execution', async () => {
    const execute = vi.fn(() => Effect.succeed(emptySearchResponse()))
    const { layer } = testLayer({ execute })

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const payload = searchPayload('/private/project-b')
        const caller = yield* refreshNamedProfileCaller(transientCaller)
        yield* authorizeLocalSessionCommand({ caller, payload })
        return yield* dispatchSessionRepositoryQuery(caller, payload)
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(layer)),
    )

    expect(error).toMatchObject({ code: 'target_scope_denied' })
    expect(execute).not.toHaveBeenCalled()
  })
})
