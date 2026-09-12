import type { TerminalOwnerKey } from '@shared/types/terminal'
import { runtimeKeyOf } from '../lib/terminal-owner'
import type { TerminalState } from './terminal-store-types'

export function omitRuntimeKeys(
  state: TerminalState,
  ownerKey: TerminalOwnerKey,
  terminalIds: readonly string[],
) {
  return omitRuntimeKeysForOwners(state, [ownerKey], terminalIds)
}

function omitRuntimeKeysForOwners(
  state: TerminalState,
  ownerKeys: readonly TerminalOwnerKey[],
  terminalIds: readonly string[],
) {
  function drop<Value>(record: Record<string, Value>) {
    const next = { ...record }
    for (const ownerKey of ownerKeys) {
      for (const terminalId of terminalIds) delete next[runtimeKeyOf(ownerKey, terminalId)]
    }
    return next
  }
  return {
    activity: drop(state.activity),
    portPreviews: drop(state.portPreviews),
    exits: drop(state.exits),
  }
}

export function omitRuntimeOwners(state: TerminalState, ownerKeys: readonly TerminalOwnerKey[]) {
  const prefixes = ownerKeys.map((ownerKey) => `${ownerKey}::`)
  function drop<Value>(record: Record<string, Value>) {
    const next = { ...record }
    for (const key of Object.keys(next)) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) delete next[key]
    }
    return next
  }
  return {
    activity: drop(state.activity),
    portPreviews: drop(state.portPreviews),
    exits: drop(state.exits),
  }
}

function rekeyRuntimeRecord<Value>(
  record: Record<string, Value>,
  fromOwnerKey: TerminalOwnerKey,
  toOwnerKey: TerminalOwnerKey,
  terminalIds: readonly string[],
) {
  const next = { ...record }
  for (const terminalId of terminalIds) {
    const previousKey = runtimeKeyOf(fromOwnerKey, terminalId)
    if (!(previousKey in next)) continue
    next[runtimeKeyOf(toOwnerKey, terminalId)] = next[previousKey]
    delete next[previousKey]
  }
  return next
}

export function rekeyRuntimeMetadata(
  state: TerminalState,
  fromOwnerKey: TerminalOwnerKey,
  toOwnerKey: TerminalOwnerKey,
  terminalIds: readonly string[],
) {
  return {
    activity: rekeyRuntimeRecord(state.activity, fromOwnerKey, toOwnerKey, terminalIds),
    portPreviews: rekeyRuntimeRecord(state.portPreviews, fromOwnerKey, toOwnerKey, terminalIds),
    exits: rekeyRuntimeRecord(state.exits, fromOwnerKey, toOwnerKey, terminalIds),
  }
}
