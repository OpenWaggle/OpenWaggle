import { describe, expect, it } from 'vitest'
import { isAdmittedWhileDraining } from '../local-session-drain-admission'

const control = (operation: string) => ({
  contract: 'session-control-v2',
  request: { command: { operation } },
})
const action = (type: string) => ({
  contract: 'host-ui-v1',
  request: { channel: 'project-actions:manage', args: [{ operation: { type } }] },
})

describe('commands a draining Session Host still accepts', () => {
  it('accepts commands that end or unblock active work', () => {
    for (const payload of [
      { contract: 'local-host-v1' },
      { contract: 'session-query-v2' },
      control('interrupt'),
      control('interrupt-descendants'),
      control('approval-respond'),
      control('request-respond'),
      control('queue-pause'),
      control('export-cancel'),
      action('stop'),
      action('output'),
    ]) {
      expect(isAdmittedWhileDraining(payload)).toBe(true)
    }
  })

  it('refuses commands that start new work', () => {
    for (const payload of [
      { contract: 'session-lifecycle-v2' },
      control('message'),
      control('follow-up'),
      action('start'),
      { contract: 'host-ui-v1', request: { channel: 'sessions:set-model', args: [] } },
      { contract: 'desktop-service-v1' },
      null,
      'session-query-v2',
    ]) {
      expect(isAdmittedWhileDraining(payload)).toBe(false)
    }
  })
})
