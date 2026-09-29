import { decodeHostUiV1Request } from '@shared/schemas/host-ui-protocol'
import type { ActionManagementRequest } from '@shared/types/action-management'
import { HOST_UI_CONTRACT_VERSION } from '@shared/types/host-ui-protocol'
import { describe, expect, it } from 'vitest'
import { isAdmittedWhileDraining } from '../local-session-drain-admission'

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

describe('commands a draining Session Host still accepts', () => {
  it('accepts commands that end or unblock active work', () => {
    for (const payload of [
      { contract: 'local-host-v1' },
      { contract: 'session-query-v2' },
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
})
