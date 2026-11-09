import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const stdout: string[] = []
  return { execute: vi.fn(), stdout }
})

vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: mocks.execute,
}))
vi.mock('../cli-stdout', () => ({
  writeCliStdout: async (value: string) => {
    mocks.stdout.push(value)
  },
}))

const { CliError, cliExitCodeForKind } = await import('../cli-error')
const { streamSessionExport } = await import('../sessions-cli-export')
const { streamFullTranscript } = await import('../sessions-cli-transcript')

const NO_ARGUMENTS = { positionals: [], passthrough: [], options: new Map() }

function refusedPage(code: string, kind: string) {
  return {
    contract: 'session-query-v2',
    response: { outcome: { operation: 'read', error: { code, kind, message: 'Refused.' } } },
  }
}

const FIRST_EXPORT_PAGE = {
  response: {
    outcome: {
      manifest: {
        schemaVersion: 1,
        sessionId: 'session-1',
        title: 'Session 1',
        branchScope: 'active-branch',
        activeBranchId: 'branch-1',
        selectedBranchId: 'branch-1',
        snapshot: {
          nodeHighWaterMark: 200,
          stateRevision: 4,
          queueRevision: 2,
          capturedAt: 1234,
          selectedHeadNodeId: 'node-1',
        },
        activeRunId: null,
        activeTurnIncomplete: false,
        queue: {
          state: 'running',
          pendingCount: 0,
          bodyScope: 'omitted-by-choice',
          omittedBodyCount: 0,
          items: [],
        },
      },
      records: [],
      nextCreatedOrder: 100,
    },
  },
}

const FIRST_TRANSCRIPT_PAGE = {
  response: {
    outcome: {
      items: [],
      highWaterMark: 200,
      nextCreatedOrder: 100,
      branchScope: 'active-branch',
      selectedBranchId: 'branch-1',
      snapshotHeadNodeId: 'node-1',
    },
  },
}

async function failure(run: () => Promise<unknown>) {
  const error: unknown = await run().then(
    () => undefined,
    (reason: unknown) => reason,
  )
  if (!(error instanceof CliError)) throw new Error(`Expected a CliError, got ${String(error)}`)
  return { kind: error.kind, exitCode: cliExitCodeForKind(error.kind), message: error.message }
}

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.stdout.length = 0
})

/** A refused later page stops the command with the kind the Session Host gave it (ADR 0063). */
describe('a refused later page of a paged read', () => {
  it('ends hive export with resync_required when the snapshot moved on', async () => {
    mocks.execute.mockResolvedValueOnce(refusedPage('resync_required', 'resync_required'))

    await expect(
      failure(() =>
        streamSessionExport({
          sessionId: 'session-1',
          firstResult: FIRST_EXPORT_PAGE,
          clientInput: fromPartial({ clientVersion: 'test' }),
          arguments: NO_ARGUMENTS,
        }),
      ),
    ).resolves.toEqual({
      kind: 'resync_required',
      exitCode: 9,
      message: 'resync_required: Refused.',
    })
  })

  it('ends hive read --full with the refusal kind of a later page', async () => {
    mocks.execute
      .mockResolvedValueOnce(FIRST_TRANSCRIPT_PAGE)
      .mockResolvedValueOnce(refusedPage('record_too_large', 'conflict'))

    await expect(
      failure(() =>
        streamFullTranscript({
          sessionId: 'session-1',
          session: {},
          clientInput: fromPartial({ clientVersion: 'test' }),
          jsonl: true,
          arguments: NO_ARGUMENTS,
        }),
      ),
    ).resolves.toMatchObject({ kind: 'conflict', exitCode: 6 })
  })
})
