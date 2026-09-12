import type { TerminalKey } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { closeAllTerminalsAction } from './terminal-close-actions'
import type { TerminalProcessInspector } from './terminal-process-inspector'
import { terminalPortPreviewsForProcessPids } from './terminal-process-ports'
import type { TerminalRuntime } from './terminal-runtime'
import type { TerminalActionContext } from './terminal-service-actions'

function samePortPreviews(
  left: ReturnType<typeof terminalPortPreviewsForProcessPids>,
  right: ReturnType<typeof terminalPortPreviewsForProcessPids>,
) {
  return (
    left.length === right.length &&
    left.every(
      (preview, index) =>
        preview.host === right[index]?.host &&
        preview.port === right[index]?.port &&
        preview.url === right[index]?.url,
    )
  )
}

export function startTerminalActivityInspection(
  inspector: TerminalProcessInspector,
  runtime: TerminalRuntime,
) {
  inspector.observe((key, snapshot) => {
    const record = runtime.records.get(key)
    if (record === undefined) return
    const portPreviews = terminalPortPreviewsForProcessPids(snapshot.processPids)
    if (
      record.activity !== null &&
      !samePortPreviews(record.activity.portPreviews ?? [], portPreviews)
    ) {
      record.activity = { ...record.activity, portPreviews }
      runtime.emitEvent(record, { type: 'port-previews', previews: portPreviews })
    }
    runtime.observeProjectActionActivity(record)
  })
  inspector.start((key, snapshot) => {
    const record = runtime.records.get(key)
    if (record === undefined) return
    const portPreviews = terminalPortPreviewsForProcessPids(snapshot.processPids)
    record.activity = {
      processName: snapshot.processName,
      processNames: snapshot.processNames,
      ports: snapshot.ports,
      portPreviews,
      processPids: snapshot.processPids,
      processIdentities: snapshot.processIdentities,
      tty: snapshot.tty,
      processReliable: snapshot.processReliable,
      reliable: snapshot.reliable,
    }
    // Successful observations reach the barrier through `observe`, including
    // snapshots whose renderer metadata did not change. A changed unreliable
    // snapshot still breaks any consecutive reliable-idle evidence.
    if (!snapshot.processReliable) runtime.observeProjectActionActivity(record)
    runtime.emitEvent(record, { type: 'ports', ports: snapshot.ports })
    runtime.emitEvent(record, { type: 'port-previews', previews: portPreviews })
    runtime.emitEvent(record, { type: 'activity', processName: snapshot.processName })
  })
}

export async function disposeTerminalResources(
  context: TerminalActionContext,
  aliases: Map<TerminalKey, TerminalKey>,
  notifyRecordChanged: () => void,
  inspector: TerminalProcessInspector,
) {
  await Effect.runPromise(closeAllTerminalsAction(context))
  aliases.clear()
  notifyRecordChanged()
  inspector.stop()
}
