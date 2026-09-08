import path from 'node:path'
import type {
  TerminalActivitySnapshot,
  TerminalAttachResult,
  TerminalKey,
} from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { app } from 'electron'
import { TerminalEventSink } from '../ports/terminal-event-sink'
import type { TerminalServiceShape } from '../ports/terminal-service'
import { TerminalService } from '../ports/terminal-service'
import { broadcastToWindows } from '../utils/broadcast'
import { ElectronTerminalEventSinkLive } from './electron-terminal-event-sink'
import {
  makeTerminalActivitySnapshotPublisher,
  terminalEventCanChangeActivitySummary,
} from './terminal/terminal-activity-snapshot'
import { makeTerminalAttachmentTracker } from './terminal/terminal-attachment-tracker'
import { makeTerminalHistoryStore } from './terminal/terminal-history-store'
import { makeTerminalInactiveRecordRetention } from './terminal/terminal-inactive-record-retention'
import type { PendingTerminalInput } from './terminal/terminal-input-idempotency'
import { resolveTerminalAlias } from './terminal/terminal-key-aliases'
import { makeTerminalOperationQueue } from './terminal/terminal-operation-queue'
import {
  makeTerminalProcessInspector,
  type TerminalProcessInspector,
} from './terminal/terminal-process-inspector'
import { makePtyRunner } from './terminal/terminal-pty-runner'
import type { TerminalRecord } from './terminal/terminal-records'
import { makeTerminalRuntime } from './terminal/terminal-runtime'
import type { TerminalActionContext } from './terminal/terminal-service-actions'
import {
  disposeTerminalResources,
  startTerminalActivityInspection,
} from './terminal/terminal-service-coordination'
import { makeTerminalServiceFacade } from './terminal/terminal-service-facade'

const TERMINAL_LOGS_DIR_NAME = 'terminal-logs'
const FALLBACK_APP_VERSION = '0.0.0'

function getElectronAppVersion() {
  const getVersion: unknown = Reflect.get(app, 'getVersion')
  if (typeof getVersion !== 'function') return FALLBACK_APP_VERSION

  try {
    const version: unknown = Reflect.apply(getVersion, app, [])
    return typeof version === 'string' && version.length > 0 ? version : FALLBACK_APP_VERSION
  } catch {
    return FALLBACK_APP_VERSION
  }
}

export interface NodePtyTerminalServiceOptions {
  readonly logsDir: string
  readonly appVersion: string
  readonly onRecordChanged?: (snapshot: TerminalActivitySnapshot) => void
  readonly maxInactiveRecords?: number
  readonly maxInactiveScrollbackBytes?: number
}

export interface TerminalServiceInternals {
  readonly records: Map<string, TerminalRecord>
  readonly history: ReturnType<typeof makeTerminalHistoryStore>
  readonly flushOutputs: () => void
  readonly dispose: () => Promise<void>
}

function inspectorTargets(record: TerminalRecord) {
  if (record.live === null || record.termination !== null) return []
  return [
    {
      key: record.key,
      pid: record.live.pid,
      tty: record.live.tty,
      ttyIdentity: record.live.ttyIdentity,
      processIdentity: record.live.processIdentity,
    },
  ]
}

export function makeNodePtyTerminalService(
  sink: TerminalEventSink['Type'],
  options: NodePtyTerminalServiceOptions,
): TerminalServiceShape & TerminalServiceInternals {
  const history = makeTerminalHistoryStore(options.logsDir)
  const inspector: TerminalProcessInspector = makeTerminalProcessInspector()
  const runner = makePtyRunner({ appVersion: options.appVersion })
  const inFlightOpens = new Map<TerminalKey, Promise<TerminalAttachResult>>()
  const operationQueue = makeTerminalOperationQueue()
  const pendingInputByKey = new Map<TerminalKey, PendingTerminalInput>()
  const terminalKeyAliases = new Map<TerminalKey, TerminalKey>()
  const attachments = makeTerminalAttachmentTracker()
  let closing = false
  let retention: ReturnType<typeof makeTerminalInactiveRecordRetention> | null = null
  const activityPublisher = makeTerminalActivitySnapshotPublisher(
    () => runtime.records.values(),
    options.onRecordChanged,
  )
  const notifyRecordChanged = activityPublisher.notify

  const resolveAlias = (requestedKey: TerminalKey) =>
    resolveTerminalAlias(terminalKeyAliases, requestedKey)

  const acknowledgeCurrentOutput = (key: TerminalKey) => {
    const record = runtime.records.get(resolveAlias(key))
    const event = record?.inFlightOutput?.event
    if (record === undefined || event === undefined) return
    runtime.acknowledgeOutput(record, event.outputGeneration, event.endOffset)
  }

  const refreshInspectorTargets = () => {
    inspector.setTargets([...runtime.records.values()].flatMap(inspectorTargets))
    notifyRecordChanged()
  }

  const runtime = makeTerminalRuntime({
    runner,
    history,
    emit: (payload) => {
      const key = terminalKeyOf(payload.ownerKey, payload.terminalId)
      const capturedAttachment = attachments.capture(key)
      const delivered = Effect.runPromise(sink.emit(payload))
        .catch(() => 0)
        .then((count) => {
          if (count === 0 && attachments.orphanIfUnchanged(key, capturedAttachment)) {
            retention?.prune()
          }
          return count
        })
      // Output is the terminal hot path and cannot change child-process
      // metadata. Lifecycle/readiness/inspector events are infrequent and
      // still reconcile record creation, activity, exit, and removal.
      if (terminalEventCanChangeActivitySummary(payload.event)) notifyRecordChanged()
      return delivered
    },
    onLivePidsChanged: refreshInspectorTargets,
    onRecordActive: (record) => retention?.markActive(record),
    onRecordInactive: (record) => retention?.markInactive(record),
    onOutputDrained: () => retention?.outputDrained(),
    onRecordMetadataChanged: () => notifyRecordChanged(),
  })

  retention = makeTerminalInactiveRecordRetention({
    runtime,
    attachments,
    aliases: terminalKeyAliases,
    pendingInputByKey,
    onRecordsChanged: refreshInspectorTargets,
    ...(options.maxInactiveRecords === undefined ? {} : { maxRecords: options.maxInactiveRecords }),
    ...(options.maxInactiveScrollbackBytes === undefined
      ? {}
      : { maxScrollbackBytes: options.maxInactiveScrollbackBytes }),
  })

  const context: TerminalActionContext = {
    runtime,
    isClosing: () => closing,
    inFlightOpens,
    operationQueue,
    pendingInputByKey,
    terminalKeyAliases,
    moveAttachments: async (fromKey, toKey) => {
      await Effect.runPromise(sink.move(fromKey, toKey))
      attachments.move(fromKey, toKey)
    },
    onRecordsRekeyed: refreshInspectorTargets,
  }

  startTerminalActivityInspection(inspector, runtime)

  const dispose = () => {
    closing = true
    return disposeTerminalResources(
      context,
      terminalKeyAliases,
      notifyRecordChanged,
      inspector,
    ).finally(() => attachments.clear())
  }

  const facade = makeTerminalServiceFacade({
    sink,
    context,
    attachments,
    resolveAlias,
    acknowledgeCurrentOutput,
    pruneInactive: () => retention?.prune(),
    getActivitySnapshot: activityPublisher.getSnapshot,
    notifyRecordChanged,
  })
  const service: TerminalServiceShape & TerminalServiceInternals = {
    records: runtime.records,
    history,
    flushOutputs: runtime.flushOutputs,
    dispose,
    ...facade,
  }

  return service
}

export const NodePtyTerminalServiceLive = Layer.scoped(
  TerminalService,
  Effect.gen(function* () {
    const sink = yield* TerminalEventSink
    const service = makeNodePtyTerminalService(sink, {
      logsDir: path.join(app.getPath('userData'), TERMINAL_LOGS_DIR_NAME),
      // Electron always supplies getVersion in production. The defensive
      // fallback keeps the service layer usable in Node-only test harnesses
      // and degraded Electron startup environments.
      appVersion: getElectronAppVersion(),
      onRecordChanged: (snapshot) => {
        broadcastToWindows('terminal:activity-snapshot', snapshot)
      },
    })
    // The inspector interval and pending history writes belong to this
    // service's lifetime, so they stop when the runtime disposes.
    yield* Effect.addFinalizer(() => Effect.promise(() => service.dispose()))
    return TerminalService.of(service)
  }),
).pipe(Layer.provide(ElectronTerminalEventSinkLive))
