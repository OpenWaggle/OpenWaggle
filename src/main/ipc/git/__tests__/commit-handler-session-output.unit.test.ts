import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sessionResourceTestLayer } from '../../../application/__tests__/session-resource-capture.fixtures'
import {
  type PendingSessionOutput,
  SessionOutputRetryRepository,
} from '../../../ports/session-output-retry-repository'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../../../ports/session-projection-repository'
import type { UpsertSessionResourceInput } from '../../../ports/session-resource-repository'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
  typedHandleMock,
} from '../../__tests__/git-handler.test-harness'

type GitCallback = (error: Error | null, stdout: string, stderr: string) => void

function commandWorkingDirectory(options: unknown) {
  if (typeof options !== 'object' || options === null) {
    throw new Error('Expected Git execution options.')
  }
  const cwd = Reflect.get(options, 'cwd')
  if (typeof cwd !== 'string') throw new Error('Expected a Git working directory.')
  return cwd
}

function installSuccessfulCommitGit(mutations: string[]) {
  execFileMock.mockImplementation(
    (_command: string, args: string[], options: unknown, callback: GitCallback) => {
      const joined = args.join(' ')
      if (args.includes('add') || args.includes('commit')) mutations.push(joined)
      if (joined === 'rev-parse --show-toplevel') {
        callback(null, `${commandWorkingDirectory(options)}\n`, '')
        return
      }
      if (joined === 'rev-parse --is-inside-work-tree') {
        callback(null, 'true\n', '')
        return
      }
      if (joined === 'ls-files --unmerged' || args.includes('status') || args.includes('add')) {
        callback(null, '', '')
        return
      }
      if (args.includes('commit')) {
        callback(null, '[feature abc123] Record direct commit\n 1 file changed\n', '')
        return
      }
      if (joined === 'rev-parse HEAD') {
        callback(null, 'abc123\n', '')
        return
      }
      callback(new Error(`Unexpected Git arguments: ${joined}`), '', '')
    },
  )
}

function sessionLayer(
  expectedWorkingPath: string,
  upserts: UpsertSessionResourceInput[],
  pendingOutputs: PendingSessionOutput[],
  options: { readonly upsertFails?: boolean } = {},
) {
  return Layer.mergeAll(
    sessionResourceTestLayer(upserts, options),
    Layer.succeed(
      SessionProjectionRepository,
      SessionProjectionRepository.of(
        fromPartial<SessionProjectionRepositoryShape>({
          getOptional: () =>
            Effect.succeed(
              fromPartial<SessionDetail>({
                id: SessionId('originating-session'),
                projectPath: expectedWorkingPath,
                environmentMode: 'local',
              }),
            ),
        }),
      ),
    ),
    Layer.succeed(
      SessionOutputRetryRepository,
      SessionOutputRetryRepository.of({
        put: (output) =>
          Effect.sync(() => {
            pendingOutputs.push(output)
            return output
          }),
        list: () => Effect.succeed(pendingOutputs),
        remove: (output) =>
          Effect.sync(() => {
            const index = pendingOutputs.findIndex(({ id }) => id === output.id)
            if (index !== -1) pendingOutputs.splice(index, 1)
          }),
      }),
    ),
  )
}

function invokeCommitWithLayer(
  workingPath: string,
  payload: unknown,
  layer: ReturnType<typeof sessionLayer>,
) {
  const handler = typedHandleMock.mock.calls.find(([channel]) => channel === 'git:commit')?.[1]
  if (typeof handler !== 'function') throw new Error('Missing git:commit handler.')
  return Effect.runPromise(Effect.provide(handler({}, workingPath, payload), layer))
}

describe('direct commit session Output recording', () => {
  let otherRepositoryPath = ''
  let repositoryPath = ''
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']

  beforeEach(async () => {
    repositoryPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-direct-commit-'))
    otherRepositoryPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-other-commit-'))
    resetGitHandlerMocks()
    ;({ registerGitHandlers } = await loadGitHandlers())
    registerGitHandlers()
  })

  afterEach(async () => {
    await Promise.all(
      [repositoryPath, otherRepositoryPath].map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  it('records one commit Output in the matching originating session', async () => {
    const mutations: string[] = []
    const upserts: UpsertSessionResourceInput[] = []
    const pendingOutputs: PendingSessionOutput[] = []
    installSuccessfulCommitGit(mutations)

    const result = await invokeCommitWithLayer(
      repositoryPath,
      {
        sessionId: SessionId('originating-session'),
        message: 'Record direct commit',
        amend: false,
        paths: ['src/direct.ts'],
      },
      sessionLayer(repositoryPath, upserts, pendingOutputs),
    )

    expect(result).toEqual({
      ok: true,
      commitHash: 'abc123',
      summary: '[feature abc123] Record direct commit',
    })
    expect(mutations.filter((command) => command.includes(' commit '))).toHaveLength(1)
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      sessionId: SessionId('originating-session'),
      canonicalKey: 'commit:abc123',
      kind: 'commit',
    })
    expect(pendingOutputs).toEqual([])
  })

  it('rejects a mismatched Session before Git mutation or Output recording', async () => {
    const mutations: string[] = []
    const upserts: UpsertSessionResourceInput[] = []
    const pendingOutputs: PendingSessionOutput[] = []
    installSuccessfulCommitGit(mutations)

    const result = await invokeCommitWithLayer(
      repositoryPath,
      {
        sessionId: SessionId('originating-session'),
        message: 'Must not commit',
        amend: false,
        paths: ['src/wrong-session.ts'],
      },
      sessionLayer(otherRepositoryPath, upserts, pendingOutputs),
    )

    expect(result).toEqual({
      ok: false,
      code: 'unknown',
      message: 'The requested working tree does not belong to the originating session.',
    })
    expect(mutations).toEqual([])
    expect(upserts).toEqual([])
    expect(pendingOutputs).toEqual([])
  })

  it('preserves the existing direct-commit behavior when no Session is supplied', async () => {
    const mutations: string[] = []
    installSuccessfulCommitGit(mutations)
    const handler = registeredHandler('git:commit')

    const result = await handler?.({}, repositoryPath, {
      message: 'Record direct commit',
      amend: false,
      paths: ['src/direct.ts'],
    })

    expect(result).toEqual({
      ok: true,
      commitHash: 'abc123',
      summary: '[feature abc123] Record direct commit',
    })
    expect(mutations.filter((command) => command.includes(' commit '))).toHaveLength(1)
  })

  it('keeps a successful commit successful when Output recording must retry', async () => {
    const mutations: string[] = []
    const upserts: UpsertSessionResourceInput[] = []
    const pendingOutputs: PendingSessionOutput[] = []
    installSuccessfulCommitGit(mutations)

    const result = await invokeCommitWithLayer(
      repositoryPath,
      {
        sessionId: SessionId('originating-session'),
        message: 'Record direct commit',
        amend: false,
        paths: ['src/direct.ts'],
      },
      sessionLayer(repositoryPath, upserts, pendingOutputs, { upsertFails: true }),
    )

    expect(result).toEqual({
      ok: true,
      commitHash: 'abc123',
      summary: '[feature abc123] Record direct commit',
    })
    expect(pendingOutputs).toHaveLength(1)
    expect(pendingOutputs[0]).toMatchObject({
      sessionId: SessionId('originating-session'),
      kind: 'commit',
      commitHash: 'abc123',
    })
  })
})
