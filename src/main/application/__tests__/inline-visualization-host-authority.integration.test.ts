import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { toHostUiJsonValue } from '@shared/host-ui-json'
import { decodeLocalSessionCommandPayloadForRevision } from '@shared/schemas/local-session-protocol'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFilesystemInlineVisualizationService } from '../../adapters/filesystem-inline-visualization-service'
import { InlineVisualizationService } from '../../ports/inline-visualization-service'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import { createLocalSessionAuthenticator } from '../../session-host/local-session-authenticator'
import {
  type LocalSessionHostRuntime,
  startLocalSessionHost,
} from '../../session-host/local-session-host-runtime'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from '../../session-host/local-session-paths'
import { ensureLocalUserCredential } from '../../session-host/local-user-credential'
import { configureGuiSessionCommandClient } from '../gui-session-command-router'
import { prepareInlineVisualizationSourceOwner } from '../inline-visualization-source-owner'
import { readInlineVisualizationSource } from '../inline-visualization-source-service'

describe('inline visualization Host authority', () => {
  let temporaryRoot = ''
  let endpointDirectory: string | null = null
  let runtime: LocalSessionHostRuntime | null = null

  afterEach(async () => {
    configureGuiSessionCommandClient(null)
    await runtime?.stop()
    if (endpointDirectory) await fs.rm(endpointDirectory, { recursive: true, force: true })
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('loads Host-owned sources through an isolated GUI without broadening filesystem access', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-visualization-host-'))
    const paths = resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot })
    endpointDirectory = paths.endpointDirectory === paths.stateRoot ? null : paths.endpointDirectory
    await prepareLocalSessionHostPaths(paths)
    const credential = await ensureLocalUserCredential(paths.credentialPath)
    const sessionId = SessionId('host-owned-visualization')
    const checkout = path.join(temporaryRoot, 'checkout')
    const worktree = path.join(temporaryRoot, 'worktree')
    await fs.mkdir(checkout)
    await fs.mkdir(worktree)
    const owner = {
      id: sessionId,
      title: 'Host visualization',
      projectPath: checkout,
      environmentMode: 'worktree' as const,
      worktreePath: worktree,
      createdAt: 1,
      updatedAt: 1,
    }
    let ownerExists = true
    const filesystem = makeFilesystemInlineVisualizationService(temporaryRoot)
    const ownerLayer = Layer.merge(
      Layer.succeed(
        SessionRepository,
        fromPartial<SessionRepositoryShape>({
          listByIds: (ids: readonly SessionId[]) => {
            expect(ids).toEqual([sessionId])
            return Effect.succeed(ownerExists ? [owner] : [])
          },
        }),
      ),
      Layer.succeed(InlineVisualizationService, filesystem),
    )
    const ownerDispatch = vi.fn(async ({ payload, negotiatedRevision }) => {
      const command = decodeLocalSessionCommandPayloadForRevision(payload, negotiatedRevision)
      if (command.contract !== 'host-ui-v1') throw new Error('Expected a Host UI request.')
      expect(command.request.channel).toBe('inline-visualization:prepare-source')
      expect(command.request.args).toEqual([{ kind: 'value', value: sessionId }])
      const input = command.request.args[0]
      const prepared = await Effect.runPromise(
        prepareInlineVisualizationSourceOwner(
          input?.kind === 'value' ? input.value : undefined,
        ).pipe(Effect.provide(ownerLayer)),
      )
      return {
        contract: 'host-ui-v1' as const,
        response: {
          contractVersion: command.request.contractVersion,
          requestId: command.request.requestId,
          channel: command.request.channel,
          result: { kind: 'value' as const, value: toHostUiJsonValue(prepared) },
        },
      }
    })
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: ownerDispatch,
    })
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })
    const localGetTree = vi.fn(() => Effect.succeed(null))
    const layer = Layer.merge(
      Layer.succeed(
        SessionRepository,
        fromPartial<SessionRepositoryShape>({ getTree: localGetTree }),
      ),
      Layer.succeed(InlineVisualizationService, filesystem),
    )
    const read = (sourcePath: string) =>
      Effect.runPromise(
        readInlineVisualizationSource({ sessionId, sourcePath }).pipe(Effect.provide(layer)),
      )
    const source = path.join(worktree, 'live-map.html')
    const checkoutSource = path.join(checkout, 'checkout-map.html')
    const ownedDirectory = await Effect.runPromise(filesystem.prepareSession(sessionId))
    const ownedSource = path.join(ownedDirectory, 'owned-map.html')
    const otherSessionDirectory = await Effect.runPromise(
      filesystem.prepareSession(SessionId('other-session')),
    )
    const otherSessionSource = path.join(otherSessionDirectory, 'private-map.html')
    await fs.writeFile(source, '<main>Host worktree</main>')
    await fs.writeFile(ownedSource, '<main>Owned storage</main>')
    await fs.writeFile(checkoutSource, '<main>Not the working tree</main>')
    await fs.writeFile(otherSessionSource, '<main>Another session</main>')

    await expect(read(source)).resolves.toMatchObject({
      status: 'loaded',
      contents: '<main>Host worktree</main>',
    })
    await expect(read(ownedSource)).resolves.toMatchObject({
      status: 'loaded',
      contents: '<main>Owned storage</main>',
    })
    await expect(read(checkoutSource)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid-path',
    })
    await expect(read(otherSessionSource)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid-path',
    })
    const abandonedTombstone = path.join(
      path.dirname(ownedDirectory),
      `.${sessionId}.deleting-00000000-0000-4000-8000-000000000000`,
    )
    await fs.rename(ownedDirectory, abandonedTombstone)
    await expect(read(ownedSource)).resolves.toMatchObject({
      status: 'loaded',
      contents: '<main>Owned storage</main>',
    })
    await expect(fs.stat(abandonedTombstone)).rejects.toMatchObject({ code: 'ENOENT' })
    ownerExists = false
    await expect(read(source)).resolves.toEqual({
      status: 'unavailable',
      reason: 'session-missing',
    })
    await expect(read(ownedSource)).resolves.toEqual({
      status: 'unavailable',
      reason: 'session-missing',
    })
    expect(localGetTree).not.toHaveBeenCalled()
    expect(ownerDispatch).toHaveBeenCalledTimes(7)
    expect(ownerDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ caller: { callerId: 'gui:local-user' } }),
    )
  })
})
