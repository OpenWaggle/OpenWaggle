import { decodeHostUiV1Request } from '@shared/schemas/host-ui-protocol'
import type { ActionManagementRequest } from '@shared/types/action-management'
import { HOST_UI_CONTRACT_VERSION, type HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import { describe, expect, it } from 'vitest'
import { READ_ONLY_HOST_UI_CHANNELS } from '../../application/host-ui-read-only-invocation'
import { isAdmittedWhileDraining } from '../local-session-drain-admission'

const query = (value: Record<string, unknown>) => ({
  contract: 'session-query-v2',
  request: { query: value },
})
const control = (operation: string) => ({
  contract: 'session-control-v2',
  request: { command: { operation } },
})

/** An Action request exactly as the desktop app puts it on the wire. */
function action(operation: ActionManagementRequest['operation']) {
  const management: ActionManagementRequest = { scope: { projectPath: '/repo' }, operation }
  const request = decodeHostUiV1Request({
    contractVersion: HOST_UI_CONTRACT_VERSION,
    requestId: 'request-1',
    channel: 'project-actions:manage',
    args: [{ kind: 'value', value: management }],
  })
  return { contract: 'host-ui-v1', request }
}

/** Any Host UI request as the desktop app puts it on the wire. */
function hostUi(channel: HostBackedGuiChannel, args: readonly unknown[]) {
  const request = decodeHostUiV1Request({
    contractVersion: HOST_UI_CONTRACT_VERSION,
    requestId: 'request-1',
    channel,
    args: args.map((value) =>
      value === undefined ? { kind: 'undefined' } : { kind: 'value', value },
    ),
  })
  return { contract: 'host-ui-v1', request }
}

describe('commands a draining Session Host still accepts', () => {
  it('keeps open Follow-up edits alive and lets them be released', () => {
    const renew = (operation: string) => ({
      contract: 'local-ui-v1',
      request: { command: { operation, sessionId: 's-1', followUpId: 'f-1', holdId: 'h-1' } },
    })
    expect(isAdmittedWhileDraining(renew('renew-follow-up-edit-hold'))).toBe(true)
    expect(isAdmittedWhileDraining(renew('pin'))).toBe(false)
    expect(isAdmittedWhileDraining(control('queue-edit-cancel'))).toBe(true)
    expect(isAdmittedWhileDraining(control('queue-edit-begin'))).toBe(false)
    expect(isAdmittedWhileDraining(control('queue-edit-save'))).toBe(false)
  })

  it("keeps answering the desktop app's reads", () => {
    expect(isAdmittedWhileDraining(hostUi('settings:get', []))).toBe(true)
    expect(isAdmittedWhileDraining(hostUi('sessions:get-detail', ['s-1']))).toBe(true)
    expect(isAdmittedWhileDraining(hostUi('agent:list-active-runs', [undefined]))).toBe(true)
    expect(isAdmittedWhileDraining(action({ type: 'runs' }))).toBe(true)
    expect(
      isAdmittedWhileDraining(
        hostUi('agent-definitions:manage', [{ command: { operation: 'list' } }]),
      ),
    ).toBe(true)
    expect(isAdmittedWhileDraining(hostUi('sessions:set-model', ['s-1', 'openai/gpt-5']))).toBe(
      false,
    )
  })

  it('accepts commands that end or unblock active work', () => {
    for (const payload of [
      { contract: 'local-host-v1' },
      query({ operation: 'read', sessionId: 's-1' }),
      query({
        operation: 'search',
        query: 'x',
        mode: 'lexical',
        requireFresh: true,
        waitTimeoutMs: 5,
      }),
      query({ operation: 'search', query: 'x', mode: 'semantic' }),
      { contract: 'local-compaction-cancel-v1' },
      { contract: 'session-waggle-cancel-v1' },
      control('interrupt'),
      control('interrupt-descendants'),
      control('approval-respond'),
      control('request-respond'),
      control('queue-pause'),
      control('export-cancel'),
      action({ type: 'stop', runId: 'run-1' }),
      action({ type: 'output', runId: 'run-1', afterOffset: 0 }),
      action({ type: 'stop-setup', attemptId: 'attempt-1' }),
    ]) {
      expect(isAdmittedWhileDraining(payload)).toBe(true)
    }
  })

  it('refuses commands that start new work', () => {
    for (const payload of [
      { contract: 'session-lifecycle-v2' },
      { contract: 'local-compaction-v1' },
      query({ operation: 'wait', targets: [] }),
      query({ operation: 'exports-wait', exportOperationId: 'e-1' }),
      query({
        operation: 'search',
        query: 'x',
        mode: 'semantic',
        requireFresh: true,
        waitTimeoutMs: 60_000,
      }),
      hostUi('mcp:list-capabilities', [undefined]),
      hostUi('agent:get-context-usage', ['s-1']),
      hostUi('providers:get-models', ['/repo']),
      hostUi('agent-definitions:manage', [{ command: { operation: 'refresh-plan' } }]),
      control('message'),
      control('follow-up'),
      action({ type: 'start', actionId: 'dev', requestId: 'request-2' }),
      { contract: 'host-ui-v1', request: { channel: 'sessions:set-model', args: [] } },
      { contract: 'desktop-service-v1' },
      null,
      'session-query-v2',
    ]) {
      expect(isAdmittedWhileDraining(payload)).toBe(false)
    }
  })

  it('decides explicitly for every read-only desktop channel', () => {
    // A new read-only channel must be added here, after checking that its handler neither
    // starts work nor loads Pi resources; otherwise it is refused while draining.
    const admitted = new Set<HostBackedGuiChannel>([
      'agent:list-active-runs',
      'sessions:get-detail',
      'sessions:list-by-ids',
      'sessions:list-page',
      'sessions:list-projects',
      'sessions:list-hive-page',
      'sessions:list-archived-branches',
      'sessions:get-tree',
      'sessions:get-workspace',
      'sessions:turn-checkpoints:list',
      'sessions:turn-diff:get',
      'sessions:turn-diff-files:get',
      'sessions:pins:list',
      'sessions:resources:get',
      'sessions:resources:locate-image',
      'sessions:resources:node-page',
      'sessions:resources:list-by-node-ids',
      'sessions:resources:thumbnail',
      'settings:get',
      'extensions:list-packages',
      'extensions:list-contributions',
      'mcp:list-secrets',
      'mcp:list-events',
      'mcp:list-event-subscriptions',
      'mcp:preview-imports',
      'docs:discover',
      'skills:list',
      'skills:get-preview',
      'agent-definitions:list-display',
      'agent-definitions:get-preview',
      'git:change-request:panel',
      'git:change-request:merge-candidate',
      'git:session:verify-working-path',
    ])
    const refused = new Set<HostBackedGuiChannel>([
      'mcp:list-capabilities',
      'agent:get-context-usage',
      'providers:get-models',
    ])

    expect(new Set([...admitted, ...refused])).toEqual(READ_ONLY_HOST_UI_CHANNELS)
    for (const channel of READ_ONLY_HOST_UI_CHANNELS) {
      expect([channel, isAdmittedWhileDraining(hostUi(channel, []))]).toEqual([
        channel,
        admitted.has(channel),
      ])
    }
    expect(
      isAdmittedWhileDraining(
        hostUi('agent-definitions:manage', [{ command: { operation: 'import-plan' } }]),
      ),
    ).toBe(false)
    // Channels whose arguments decide whether they only read.
    const reads: ActionManagementRequest['operation'][] = [
      { type: 'catalog' },
      { type: 'discover' },
      { type: 'runs' },
      { type: 'preparation' },
      { type: 'retained-preparation' },
    ]
    for (const operation of reads) {
      expect([operation.type, isAdmittedWhileDraining(action(operation))]).toEqual([
        operation.type,
        true,
      ])
    }
    expect(isAdmittedWhileDraining(hostUi('mcp:get-settings', []))).toBe(true)
    expect(isAdmittedWhileDraining(hostUi('mcp:get-settings', [{ reconcileRuntime: true }]))).toBe(
      false,
    )
  })
})
