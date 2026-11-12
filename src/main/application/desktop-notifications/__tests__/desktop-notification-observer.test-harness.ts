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
  DesktopNotificationLatestRun,
  DesktopNotificationRunFacts,
  DesktopNotificationSessionFacts,
} from '../../../ports/desktop-notification-facts'
import { DesktopNotificationLedger } from '../desktop-notification-ledger'
import { DesktopNotificationObserver } from '../desktop-notification-observer'
import { HostStateDesktopNotifications } from '../host-state-desktop-notifications'

export const PERSON = 'gui:local-user'
export const AGENT = 'session-agent:queen:run-1'

export interface Fixture {
  sessions: Record<string, DesktopNotificationSessionFacts>
  runs: Record<string, DesktopNotificationRunFacts>
  visits: Record<string, number>
  stuck: string[]
  pending: Record<string, 'approval' | 'question'>
  desktopConnected: boolean
  preferences: DesktopNotificationSettings
  /** Spawn lineage: each Worker's parent. */
  parents: Record<string, string>
  /** Sessions with a running Run. */
  running: Set<string>
  /** Idle parents a Hive wake is still coming for. */
  wakeComing: Set<string>
  agentMade: Set<string>
  /** Root Runs the person started while Workers below were running. */
  midWorkRuns: Set<string>
  /** Each Session's latest Run as stored, when a test needs one. */
  latestRuns: Record<string, DesktopNotificationLatestRun>
}

export function session(
  sessionId: string,
  overrides: Partial<DesktopNotificationSessionFacts> = {},
) {
  return {
    sessionId,
    title: `Title ${sessionId}`,
    projectPath: '/work/openwaggle',
    archived: false,
    parentSessionId: null,
    parentTitle: null,
    ...overrides,
  } satisfies DesktopNotificationSessionFacts
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
    parents: {},
    running: new Set(),
    wakeComing: new Set(),
    agentMade: new Set(),
    midWorkRuns: new Set(),
    latestRuns: {},
    ...overrides,
  }
  const published: SessionHostEventPayload[] = []
  const hostShown: { notification: DesktopNotification; sound: 'system' | 'none' }[] = []
  const hostWithdrawn: string[] = []
  const rootOf = (id: string): string => {
    const parent = fixture.parents[id]
    return parent === undefined ? id : rootOf(parent)
  }
  const subtree = (root: string) =>
    Object.keys({ ...fixture.sessions, ...fixture.parents }).filter((id) => rootOf(id) === root)
  const facts: DesktopNotificationFactsShape = {
    session: (id) => Effect.succeed(fixture.sessions[id] ?? null),
    run: (_sessionId, runId) => Effect.succeed(fixture.runs[runId] ?? null),
    hiveRootSessionId: (id) => Effect.succeed(rootOf(id)),
    hiveActivity: (root, runId) =>
      Effect.sync(() => {
        const workers = subtree(root).filter((id) => id !== root)
        return {
          rootRunning: fixture.running.has(root),
          workersRunning: workers.some((id) => fixture.running.has(id)),
          wakeComing: [root, ...workers].some((id) => fixture.wakeComing.has(id)),
          // Workers are agent-made; the root is the person's unless the fixture says otherwise.
          limitedWakeComing: [root, ...workers].some(
            (id) => fixture.wakeComing.has(id) && (id !== root || fixture.agentMade.has(id)),
          ),
          runStartedWhileWorkersRan: runId !== null && fixture.midWorkRuns.has(runId),
        }
      }),
    latestRun: (id) => Effect.succeed(fixture.latestRuns[id] ?? null),
    activeWorkerRunCount: () => Effect.succeed(fixture.running.size),
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

export function settled(
  runId: string,
  terminalStatus: 'completed' | 'failed' | 'interrupted',
  options: { readonly sessionId?: string; readonly hiveWake?: true } = {},
) {
  return fromPartial<SessionHostEventPayload>({
    kind: 'session-state-changed',
    sessionId: options.sessionId ?? 'root',
    stateRevision: 2,
    operation: 'run-settled',
    runId,
    terminalStatus,
    ...(options.hiveWake ? { hiveWake: true } : {}),
  })
}

/** The Session's assistant finished a reply: the preview its Ready to read carries. */
export function replied(sessionId: string, content: string) {
  return fromPartial<SessionHostEventPayload>({
    kind: 'session-transport',
    sessionId,
    event: { type: 'message_update', assistantMessageEvent: { type: 'text_end', content } },
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
