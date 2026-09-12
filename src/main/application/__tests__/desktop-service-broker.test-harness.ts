import { SessionId } from '@shared/types/brand'
import type { DesktopOwnerRecord } from '@shared/types/desktop-owner'
import type {
  DesktopCommandEnvelope,
  DesktopFenceRecord,
  DesktopServiceCommand,
  DesktopServiceResult,
} from '@shared/types/desktop-service'
import { Cause, Effect, Exit } from 'effect'
import type { DesktopFenceRepositoryShape } from '../../ports/desktop-fence-repository'
import type { DesktopOwnerRepositoryShape } from '../../ports/desktop-owner-repository'
import { makeDesktopServiceBroker } from '../desktop-service-broker'

export const browserCommand = {
  service: 'browser' as const,
  operation: 'status' as const,
  scope: { sessionId: SessionId('session-one'), workingPath: '/repo/worktree' },
  input: {},
}
export const browserResult = {
  service: 'browser' as const,
  operation: 'status' as const,
  value: {
    available: false,
    visible: false,
    tabId: null,
    url: null,
    title: null,
    loading: false,
    viewport: null,
    appearance: null,
  },
}

export function brokerHarness(
  initial: readonly DesktopFenceRecord[] = [],
  initialOwner: DesktopOwnerRecord | null = null,
) {
  const records = new Map(initial.map((record) => [record.token, record]))
  const writes: string[] = []
  let ownerRecord = initialOwner
  const owners: DesktopOwnerRepositoryShape = {
    get: () => Effect.sync(() => ownerRecord),
    activate: (owner) =>
      Effect.try({
        try: () => {
          if (ownerRecord?.state === 'active' && ownerRecord.guiInstanceId !== owner.guiInstanceId)
            throw new Error('The previous desktop has not confirmed native resource cleanup.')
          ownerRecord = { ...owner, state: 'active' }
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    markClosed: (guiInstanceId, hostInstanceId) =>
      Effect.try({
        try: () => {
          if (
            !ownerRecord ||
            ownerRecord.guiInstanceId !== guiInstanceId ||
            ownerRecord.hostInstanceId !== hostInstanceId
          )
            throw new Error('The native cleanup receipt does not match the current desktop owner.')
          ownerRecord = { ...ownerRecord, state: 'closed' }
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
  }
  const offlineCommands: DesktopServiceCommand[] = []
  const offlineExecute = (
    command: DesktopServiceCommand,
  ): Effect.Effect<DesktopServiceResult, Error> =>
    Effect.suspend<DesktopServiceResult, Error, never>(() => {
      offlineCommands.push(command)
      if (command.service === 'browser' && command.operation === 'deleteOwner')
        return Effect.succeed({ service: 'browser', operation: 'deleteOwner', value: null })
      if (command.service === 'terminal' && command.operation === 'closeAllForOwner')
        return Effect.succeed({ service: 'terminal', operation: 'closeAllForOwner', value: null })
      return Effect.fail(new Error('No offline native implementation for this command.'))
    })
  const repository: DesktopFenceRepositoryShape = {
    getAll: () => Effect.succeed([...records.values()]),
    insert: (record) =>
      Effect.try({
        try: () => {
          if (records.has(record.token)) throw new Error('Duplicate token')
          records.set(record.token, record)
          writes.push(`insert:${record.token}`)
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    markReleased: (token, hostInstanceId) =>
      Effect.try({
        try: () => {
          const record = records.get(token)
          if (!record || record.hostInstanceId !== hostInstanceId)
            throw new Error('Unknown fence owner')
          records.set(token, { ...record, state: 'released' })
          writes.push(`released:${token}`)
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    removeReleased: (token, hostInstanceId) =>
      Effect.try({
        try: () => {
          const record = records.get(token)
          if (!record || record.hostInstanceId !== hostInstanceId || record.state !== 'released')
            throw new Error('Fence is not released by this Host')
          records.delete(token)
          writes.push(`removed:${token}`)
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
  }
  const broker = makeDesktopServiceBroker({
    getHostInstanceId: () => 'host-one',
    fences: repository,
    owners,
    offlineExecute,
  })

  async function register(guiInstanceId = 'gui-one') {
    const response = await Effect.runPromise(
      broker.handleGuiRequest({ operation: 'register', guiInstanceId }),
    )
    if (response.operation !== 'register') throw new Error('Expected register response')
    return response
  }
  async function ready(leaseId: string, fenceTokens: readonly string[] = []) {
    return Effect.runPromise(broker.handleGuiRequest({ operation: 'ready', leaseId, fenceTokens }))
  }
  async function connect(guiInstanceId = 'gui-one') {
    const response = await register(guiInstanceId)
    await ready(
      response.leaseId,
      response.fences.filter((fence) => fence.state === 'active').map((fence) => fence.token),
    )
    return response.leaseId
  }
  async function poll(leaseId: string) {
    const response = await Effect.runPromise(
      broker.handleGuiRequest({ operation: 'poll', leaseId }),
    )
    if (response.operation !== 'poll') throw new Error('Expected poll response')
    return response
  }
  async function complete(
    leaseId: string,
    command: DesktopCommandEnvelope,
    result: DesktopServiceResult = browserResult,
  ) {
    return Effect.runPromise(
      broker.handleGuiRequest({
        operation: 'complete',
        leaseId,
        completion: { commandId: command.commandId, outcome: 'success', result },
      }),
    )
  }
  return {
    broker,
    records,
    writes,
    repository,
    owners,
    ownerRecord: () => ownerRecord,
    offlineCommands,
    register,
    ready,
    connect,
    poll,
    complete,
  }
}

export function firstCommand(envelopes: readonly DesktopCommandEnvelope[]) {
  const command = envelopes[0]
  if (!command) throw new Error('Expected a dispatched desktop command')
  return command
}

export function exitMessage<A, E>(exit: Exit.Exit<A, E>) {
  if (Exit.isSuccess(exit)) throw new Error('Expected failure')
  return Cause.pretty(exit.cause)
}

export function activeFence(token = 'fence-old'): DesktopFenceRecord {
  return {
    token,
    hostInstanceId: 'host-one',
    scope: { kind: 'owner', ownerKey: 'session-one' },
    state: 'active',
  }
}
