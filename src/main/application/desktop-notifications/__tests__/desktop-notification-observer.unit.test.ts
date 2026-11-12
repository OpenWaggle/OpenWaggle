import { DEFAULT_DESKTOP_NOTIFICATION_SETTINGS } from '@shared/types/desktop-notification'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  AGENT,
  approvalRequest,
  resolved,
  session,
  settled,
  setup,
  shownKinds,
} from './desktop-notification-observer.test-harness'

describe('DesktopNotificationObserver', () => {
  it('announces a root Run the person started as Ready to read, once', async () => {
    const { emit, published, ledger } = setup()
    await emit(settled('run-1', 'completed'))
    await emit(settled('run-1', 'completed'))

    expect(shownKinds(published)).toEqual(['shown:completed'])
    expect(ledger.list()[0]).toMatchObject({
      category: 'ready-to-read',
      title: 'Title root · openwaggle',
      body: 'Ready to read',
      presentedBy: 'desktop',
    })
  })

  it('stays quiet for a Run the person interrupted, a Worker, or another agent', async () => {
    const worker = setup({
      sessions: { root: session('root', { parentSessionId: 'queen', parentTitle: 'Queen' }) },
    })
    await worker.emit(settled('run-1', 'completed'))
    expect(worker.published).toEqual([])

    const agent = setup({ runs: { 'run-1': { originCallerId: AGENT, scheduledTaskPolicy: null } } })
    await agent.emit(settled('run-1', 'failed'))
    expect(agent.published).toEqual([])

    const interrupted = setup()
    await interrupted.emit(settled('run-1', 'interrupted'))
    expect(interrupted.published).toEqual([])
  })

  it('lets a failures-only Scheduled task announce failures but not completions', async () => {
    const runs = {
      'run-1': { originCallerId: AGENT, scheduledTaskPolicy: 'failures-only' as const },
    }
    const completed = setup({ runs })
    await completed.emit(settled('run-1', 'completed'))
    expect(completed.published).toEqual([])

    const failed = setup({ runs })
    await failed.emit(settled('run-1', 'failed'))
    expect(shownKinds(failed.published)).toEqual(['shown:failed'])
  })

  it('skips a Run the person already saw, and withdraws Ready to read on a later visit', async () => {
    const seen = setup({ visits: { root: 150 } })
    await seen.emit(settled('run-1', 'completed'), 100)
    expect(seen.published).toEqual([])

    const later = setup()
    await later.emit(settled('run-1', 'completed'), 100)
    later.fixture.visits['root'] = 200
    await later.emit(
      fromPartial<SessionHostEventPayload>({
        kind: 'session-list-changed',
        sessionId: 'root',
        change: 'updated',
        catalogOnly: true,
      }),
    )
    expect(shownKinds(later.published)).toEqual([
      'shown:completed',
      'desktop-notification-withdrawn',
    ])
  })

  it('announces Needs you for a Worker even when muted, and withdraws it once answered', async () => {
    const { emit, published, ledger, fixture } = setup({
      sessions: { worker: session('worker', { parentSessionId: 'queen', parentTitle: 'Queen' }) },
      preferences: { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS, mutedSessionIds: ['worker'] },
    })
    fixture.pending['worker'] = 'approval'
    await emit(approvalRequest('worker'))
    expect(ledger.list()[0]).toMatchObject({
      reason: 'awaiting-approval',
      title: 'Title worker · openwaggle · Worker of Queen',
      body: 'Waiting for your approval',
    })
    expect(ledger.list()[0]?.preview).toBeUndefined()

    // Another request still parks there: the notification stands.
    await emit(resolved('worker'))
    expect(ledger.list()).toHaveLength(1)

    delete fixture.pending['worker']
    await emit(resolved('worker'))
    expect(shownKinds(published)).toEqual([
      'shown:awaiting-approval',
      'desktop-notification-withdrawn',
    ])
  })

  it('keeps a standing Needs you over a later Ready to read', async () => {
    const { emit, ledger } = setup()
    await emit(approvalRequest('root'))
    await emit(settled('run-1', 'completed'))
    expect(ledger.list().map((notification) => notification.reason)).toEqual(['awaiting-approval'])
  })

  it('includes a preview only when Show previews is on', async () => {
    const { emit, ledger } = setup({
      preferences: { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS, showPreviews: true },
    })
    await emit(approvalRequest('root'))
    expect(ledger.list()[0]?.preview).toBe('Run bash: rm -rf build')
  })

  it('shows the notification from the Host while no desktop app is connected', async () => {
    const { emit, hostShown, ledger, hostWithdrawn } = setup({ desktopConnected: false })
    await emit(settled('run-1', 'completed'))
    expect(hostShown).toEqual([
      expect.objectContaining({
        notification: expect.objectContaining({ presentedBy: 'host' }),
        sound: 'system',
      }),
    ])
    await emit(
      fromPartial<SessionHostEventPayload>({
        kind: 'session-list-changed',
        sessionId: 'root',
        change: 'archived',
      }),
    )
    expect(ledger.list()).toEqual([])
    expect(hostWithdrawn).toEqual(['session:root'])
  })

  it('announces one Agent error per Run', async () => {
    const { emit, published } = setup()
    const error = fromPartial<SessionHostEventPayload>({
      kind: 'session-transport',
      sessionId: 'root',
      event: {
        type: 'agent_interaction_request',
        interaction: { kind: 'notify', runId: 'run-1', level: 'error', message: 'Lint failed' },
      },
    })
    await emit(error)
    await emit(error)
    expect(shownKinds(published)).toEqual(['shown:agent-error'])
  })

  it('stays silent when the category or the master switch is off', async () => {
    const off = setup({
      preferences: { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS, enabled: false },
    })
    await off.emit(approvalRequest('root'))
    expect(off.published).toEqual([])
  })
})
