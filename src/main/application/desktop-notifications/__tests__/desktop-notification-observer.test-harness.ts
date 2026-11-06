/** Shared fixture for the Desktop notification observer tests: fake facts and a recording ledger. */
import {
  DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
  type DesktopNotification,
  type DesktopNotificationSettings,
} from '@shared/types/desktop-notification'
import type {
  SessionHostEventEnvelope,
  SessionHostEventPayload,
} from '@shared/types/session-host-event'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import type {
  DesktopNotificationFactsShape,
  DesktopNotificationRunFacts,
  DesktopNotificationSessionFacts,
} from '../../../ports/desktop-notification-facts'
import { DesktopNotificationLedger } from '../desktop-notification-ledger'
import { DesktopNotificationObserver } from '../desktop-notification-observer'
import { HostStateDesktopNotifications } from '../host-state-desktop-notifications'

export const PERSON = 'gui:local-user'
export const AGENT = 'session-agent:queen:run-1'

interface Fixture {
  sessions: Record<string, DesktopNotificationSessionFacts>
  runs: Record<string, DesktopNotificationRunFacts>
  visits: Record<string, number>
  stuck: string[]
  pending: Record<string, 'approval' | 'question'>
  desktopConnected: boolean
  preferences: DesktopNotificationSettings
}

export function session(
  sessionId: string,
  overrides: Partial<DesktopNotificationSessionFacts> = {},
): DesktopNotificationSessionFacts {
  return {
    sessionId,
    title: `Title ${sessionId}`,
    projectPath: '/work/openwaggle',
    archived: false,
    parentSessionId: null,
    parentTitle: null,
    ...overrides,
  }
}

export function setup(overrides: Partial<Fixture> = {}) {
  const fixture: Fixture = {
    sessions: { root: session('root') },
    runs: { 'run-1': { originCallerId: PERSON, scheduledTaskPolicy: null } },
    visits: {},
    stuck: [],
    pending: {},
    desktopConnected: true,
    preferences: DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
    ...overrides,
  }
  const published: SessionHostEventPayload[] = []
  const hostShown: { notification: DesktopNotification; sound: 'system' | 'none' }[] = []
  const hostWithdrawn: string[] = []
  const facts: DesktopNotificationFactsShape = {
    session: (id) => Effect.succeed(fixture.sessions[id] ?? null),
    run: (_sessionId, runId) => Effect.succeed(fixture.runs[runId] ?? null),
    lastVisitedAt: (id) => Effect.succeed(fixture.visits[id] ?? null),
    stuckWorkerIds: () => Effect.succeed([...fixture.stuck]),
    runsInterruptedByHostLossSince: () => Effect.succeed([{ sessionId: 'root', runId: 'run-1' }]),
  }
  const settings: Settings = { ...DEFAULT_SETTINGS }
  const ledger = new DesktopNotificationLedger({
    facts,
    readSettings: () => Effect.succeed({ ...settings, desktopNotifications: fixture.preferences }),
    publish: (payload) => published.push(payload),
    desktopAppConnected: () => fixture.desktopConnected,
    hostPresenter: {
      show: (notification, sound) => hostShown.push({ notification, sound }),
      withdraw: (id) => hostWithdrawn.push(id),
    },
  })
  const observer = new DesktopNotificationObserver({
    ledger,
    facts,
    pendingRequest: (id) => fixture.pending[id] ?? null,
  })
  const hostState = new HostStateDesktopNotifications({ ledger, observer, facts, now: () => 500 })
  const emit = (payload: SessionHostEventPayload, timestamp = 100) =>
    Effect.runPromise(
      observer.handle(fromPartial<SessionHostEventEnvelope>({ payload, timestamp })),
    )
  return { fixture, ledger, observer, hostState, published, hostShown, hostWithdrawn, emit }
}

export function settled(runId: string, terminalStatus: 'completed' | 'failed' | 'interrupted') {
  return fromPartial<SessionHostEventPayload>({
    kind: 'session-state-changed',
    sessionId: 'root',
    stateRevision: 2,
    operation: 'run-settled',
    runId,
    terminalStatus,
  })
}

export function approvalRequest(sessionId: string) {
  return fromPartial<SessionHostEventPayload>({
    kind: 'session-transport',
    sessionId,
    event: {
      type: 'agent_interaction_request',
      interaction: {
        kind: 'confirm',
        runId: 'run-1',
        title: 'Run bash',
        message: 'rm -rf build',
        purpose: 'authorization',
      },
    },
  })
}

export function resolved(sessionId: string) {
  return fromPartial<SessionHostEventPayload>({
    kind: 'session-transport',
    sessionId,
    event: { type: 'agent_interaction_resolved', runId: 'run-1' },
  })
}

export function shownKinds(published: readonly SessionHostEventPayload[]) {
  return published.map((payload) =>
    payload.kind === 'desktop-notification-shown'
      ? `shown:${payload.notification.reason}`
      : payload.kind,
  )
}
