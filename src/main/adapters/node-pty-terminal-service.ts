import path from 'node:path'
import type {
  TerminalAttachResult,
  TerminalId,
  TerminalKey,
  TerminalOpenInput,
  TerminalOwnerKey,
} from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { app } from 'electron'
import { TerminalEventSink } from '../ports/terminal-event-sink'
import type { TerminalServiceShape } from '../ports/terminal-service'
import { TerminalService } from '../ports/terminal-service'
import { ElectronTerminalEventSinkLive } from './electron-terminal-event-sink'
import { makeTerminalHistoryStore } from './terminal/terminal-history-store'
import {
  makeTerminalProcessInspector,
  type TerminalProcessInspector,
} from './terminal/terminal-process-inspector'
import { makePtyRunner } from './terminal/terminal-pty-runner'
import type { TerminalRecord } from './terminal/terminal-records'
import { makeTerminalRuntime } from './terminal/terminal-runtime'
import {
  clearTerminalAction,
  closeAllTerminalsAction,
  closeOwnerTerminalsAction,
  closeTerminalAction,
  closeTerminalsUnderPathAction,
  openTerminalAction,
  resizeTerminalAction,
  restartTerminalAction,
  type TerminalActionContext,
  writeTerminalAction,
} from './terminal/terminal-service-actions'

const TERMINAL_LOGS_DIR_NAME = 'terminal-logs'

export interface NodePtyTerminalServiceOptions {
  readonly logsDir: string
  readonly onRecordChanged?: () => void
}

export interface TerminalServiceInternals {
  readonly records: Map<string, TerminalRecord>
  readonly history: ReturnType<typeof makeTerminalHistoryStore>
  readonly flushOutputs: () => void
  readonly dispose: () => Promise<void>
}

export function makeNodePtyTerminalService(
  sink: TerminalEventSink['Type'],
  options: NodePtyTerminalServiceOptions,
): TerminalServiceShape & TerminalServiceInternals {
  const history = makeTerminalHistoryStore(options.logsDir)
  const inspector: TerminalProcessInspector = makeTerminalProcessInspector()
  const runner = makePtyRunner()
  const inFlightOpens = new Map<TerminalKey, Promise<TerminalAttachResult>>()
  let closing = false

  const runtime = makeTerminalRuntime({
    runner,
    history,
    emit: (payload) => Effect.runPromise(sink.emit(payload)).catch(() => undefined),
    onLivePidsChanged: () => {
      inspector.setTargets(
        [...runtime.records.values()].flatMap((record) =>
          record.live === null ? [] : [{ key: record.key, pid: record.live.pid }],
        ),
      )
    },
  })

  const context: TerminalActionContext = {
    runtime,
    isClosing: () => closing,
    inFlightOpens,
  }

  inspector.start((key, snapshot) => {
    const record = runtime.records.get(key)
    if (record === undefined) return
    // Emit on every change, including a transition to zero ports, so stale
    // port-preview chips disappear when their server stops. The sink's
    // change detection keeps repeated identical snapshots cheap.
    runtime.emitEvent(record, { type: 'ports', ports: snapshot.ports })
    runtime.emitEvent(record, { type: 'activity', processName: snapshot.processName })
  })

  const dispose = async () => {
    closing = true
    await Effect.runPromise(closeAllTerminalsAction(context)).catch(() => undefined)
    inspector.stop()
  }

  const service: TerminalServiceShape & TerminalServiceInternals = {
    records: runtime.records,
    history,
    flushOutputs: runtime.flushOutputs,
    dispose,

    attachSurface: (terminalKey, surfaceId) => sink.attach(terminalKey, surfaceId),

    detachTerminal: (ownerKey: TerminalOwnerKey, terminalId: TerminalId, surfaceId: number) =>
      sink.detach(terminalKeyOf(ownerKey, terminalId), surfaceId),

    detachSurface: (surfaceId) => sink.detachSurface(surfaceId),

    open: (input: TerminalOpenInput) => openTerminalAction(context, input),

    write: (ownerKey: TerminalOwnerKey, terminalId: TerminalId, data: string) =>
      writeTerminalAction(context, ownerKey, terminalId, data),

    resize: (ownerKey: TerminalOwnerKey, terminalId: TerminalId, cols: number, rows: number) =>
      resizeTerminalAction(context, ownerKey, terminalId, cols, rows),

    clear: (ownerKey: TerminalOwnerKey, terminalId: TerminalId) =>
      clearTerminalAction(context, ownerKey, terminalId),

    restart: (input: TerminalOpenInput) => restartTerminalAction(context, input),

    close: (ownerKey: TerminalOwnerKey, terminalId: TerminalId, deleteHistory: boolean) =>
      closeTerminalAction(context, ownerKey, terminalId, deleteHistory),

    closeAllForOwner: (ownerKey: TerminalOwnerKey, deleteHistory: boolean) =>
      closeOwnerTerminalsAction(context, ownerKey, deleteHistory),

    closeAllUnderPath: (directoryPath: string, deleteHistory: boolean) =>
      closeTerminalsUnderPathAction(context, directoryPath, deleteHistory),

    closeAll: () => closeAllTerminalsAction(context),
  }

  return service
}

export const NodePtyTerminalServiceLive = Layer.scoped(
  TerminalService,
  Effect.gen(function* () {
    const sink = yield* TerminalEventSink
    const service = makeNodePtyTerminalService(sink, {
      logsDir: path.join(app.getPath('userData'), TERMINAL_LOGS_DIR_NAME),
    })
    // The inspector interval and pending history writes belong to this
    // service's lifetime, so they stop when the runtime disposes.
    yield* Effect.addFinalizer(() => Effect.promise(() => service.dispose()))
    return TerminalService.of(service)
  }),
).pipe(Layer.provide(ElectronTerminalEventSinkLive))
