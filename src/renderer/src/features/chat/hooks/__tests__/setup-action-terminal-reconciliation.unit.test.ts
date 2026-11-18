import { WORKTREE_CREATED_CUSTOM_EVENT } from '@shared/types/background-run'
import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalStore } from '@/features/terminal'
import {
  reconcileDurableSetupActionEvents,
  reconcileLiveSetupActionTerminals,
} from '../useSetupActionTerminalReconciliation'

const SESSION_ID = SessionId('session-1')
const SETUP_ACTION = {
  terminalId: 'setup-terminal-1',
  actionId: 'setup-action-1',
  actionName: 'Install',
  projectRoot: '/repo',
  cwd: '/repo/.openwaggle/session-1',
} as const

describe('setup action terminal recovery sources', () => {
  beforeEach(() => {
    useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
  })

  it('reconciles setup metadata delivered by a live launch snapshot', () => {
    reconcileLiveSetupActionTerminals(
      new Map([
        [
          SESSION_ID,
          {
            status: 'running',
            stage: 'starting-task',
            startedAt: 1,
            updatedAt: 2,
            details: [],
            setupAction: SETUP_ACTION,
          },
        ],
      ]),
    )

    expect(useTerminalStore.getState().groups[SESSION_ID]?.tabs[0]?.panes[0]).toMatchObject({
      terminalId: SETUP_ACTION.terminalId,
      cwd: SETUP_ACTION.cwd,
    })
  })

  it('reconciles the same terminal once from durable worktree-created events after reload', () => {
    const event = {
      type: 'custom' as const,
      timestamp: 3,
      name: WORKTREE_CREATED_CUSTOM_EVENT,
      value: { details: ['Created worktree'], setupAction: SETUP_ACTION },
    }
    reconcileDurableSetupActionEvents(String(SESSION_ID), [event, event])

    const tabs = useTerminalStore.getState().groups[SESSION_ID]?.tabs
    expect(tabs).toHaveLength(1)
    expect(tabs?.[0]?.customName).toBe('Setup · Install')
  })
})
