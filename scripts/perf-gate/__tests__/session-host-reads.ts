/**
 * The desktop window's Session reads as the Session Host serves them, measured. A call takes the
 * path a GUI request takes once it reaches the Host (`session-host-bootstrap.ts`): the payload the
 * GUI builds (`configured-host-ui-client.ts`, `session-control-handler.ts`) crosses as JSON, is
 * decoded for the current protocol revision and runs through `dispatchLocalSessionCommand` on the
 * app runtime, against the real SQLite store. Each reply crosses back as JSON, and its size is
 * what the window receives.
 */
import { toHostUiJsonValue } from '@shared/host-ui-json'
import { parseJsonUnknown } from '@shared/schema'
import { decodeLocalSessionCommandPayloadForRevision } from '@shared/schemas/local-session-protocol'
import { decodeSessionQueryRequest } from '@shared/schemas/session-query'
import { HOST_UI_CONTRACT_VERSION, type HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import type { IpcInvokeArgs, IpcInvokeReturn } from '@shared/types/ipc'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol-revisions'
import type { SessionQueryRequest } from '@shared/types/session-query'
import { dispatchLocalSessionCommand } from '../../../src/main/application/local-session-command-dispatcher'
import type { runAppEffect } from '../../../src/main/runtime'
import type { SqliteWork, SqliteWorkMeter } from './sqlite-work-meter'

type RunAppEffect = typeof runAppEffect

/** The window's caller identity (`session-control-handler.ts`), from a fixed directory. */
const GUI_CALLER = { callerId: 'gui:local-user', workingDirectory: '/' } as const

export interface MeasuredReads extends SqliteWork {
  /** UTF-8 bytes of every reply, as JSON. */
  readonly bytes: number
  /** The channels called, in order. */
  readonly channels: readonly string[]
}

/** A JSON round trip: what the socket and the window's IPC carry. No reply crosses as nothing. */
function overTheWire(value: unknown) {
  return value === undefined ? undefined : parseJsonUnknown(JSON.stringify(value))
}

function wireBytes(value: unknown) {
  return value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value), 'utf8')
}

let hostUiRequestCount = 0

export function sessionHostReads(runEffect: RunAppEffect, meter: SqliteWorkMeter) {
  let bytes = 0
  let channels: string[] = []

  function record(channel: string, reply: unknown) {
    bytes += wireBytes(reply)
    channels.push(channel)
  }

  async function command(payload: LocalSessionCommandPayload) {
    return runEffect(
      dispatchLocalSessionCommand({
        caller: GUI_CALLER,
        negotiatedRevision: LOCAL_SESSION_CURRENT_REVISION,
        payload: decodeLocalSessionCommandPayloadForRevision(
          overTheWire(payload),
          LOCAL_SESSION_CURRENT_REVISION,
        ),
      }),
    )
  }

  function hostUi<C extends HostBackedGuiChannel>(
    channel: C,
    ...args: IpcInvokeArgs<C>
  ): Promise<IpcInvokeReturn<C>>
  async function hostUi(channel: HostBackedGuiChannel, ...args: readonly unknown[]) {
    hostUiRequestCount += 1
    const requestId = `perf-budget-request-${String(hostUiRequestCount)}`
    const result = await command({
      contract: 'host-ui-v1',
      request: {
        contractVersion: HOST_UI_CONTRACT_VERSION,
        requestId,
        channel,
        args: args.map((argument) =>
          argument === undefined
            ? { kind: 'undefined' as const }
            : { kind: 'value' as const, value: toHostUiJsonValue(argument) },
        ),
      },
    })
    if (result.contract !== 'host-ui-v1' || result.response.requestId !== requestId) {
      throw new Error(`The Session Host answered ${channel} with another reply.`)
    }
    const reply =
      result.response.result.kind === 'undefined' ? undefined : result.response.result.value
    record(channel, reply)
    return overTheWire(reply)
  }

  async function querySessionControl(request: SessionQueryRequest) {
    const result = await command({
      contract: 'session-query-v2',
      request: decodeSessionQueryRequest(request),
    })
    if (result.contract !== 'session-query-v2') {
      throw new Error('The Session Host answered a Session query with another contract.')
    }
    record('session-control:query', result.response)
    return result.response
  }

  /** Runs `reads` and returns their result, what they moved and what SQLite did for them. */
  async function measure<T>(reads: () => Promise<T>) {
    meter.take()
    bytes = 0
    channels = []
    const result = await reads()
    const measured: MeasuredReads & { readonly result: T } = {
      ...meter.take(),
      bytes,
      channels,
      result,
    }
    return measured
  }

  return { hostUi, querySessionControl, measure }
}

export type SessionHostReads = ReturnType<typeof sessionHostReads>
