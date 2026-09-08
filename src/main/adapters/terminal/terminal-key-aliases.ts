import type { TerminalKey, TerminalOwnerKey } from '@shared/types/terminal'
import { ownerKeyFromTerminalKey } from './terminal-history-files'

export function resolveTerminalAlias(
  aliases: ReadonlyMap<TerminalKey, TerminalKey>,
  requestedKey: TerminalKey,
) {
  let key = requestedKey
  const visited = new Set<TerminalKey>()
  while (!visited.has(key)) {
    visited.add(key)
    const next = aliases.get(key)
    if (next === undefined) break
    key = next
  }
  return key
}

/** Keep only the immediately previous owner as a late-call compatibility alias. */
export function replaceTerminalAlias(
  aliases: Map<TerminalKey, TerminalKey>,
  fromKey: TerminalKey,
  toKey: TerminalKey,
) {
  pruneTerminalAliasesForKey(aliases, fromKey)
  aliases.set(fromKey, toKey)
}

export function pruneTerminalAliasesForKey(
  aliases: Map<TerminalKey, TerminalKey>,
  closedKey: TerminalKey,
) {
  for (const source of [...aliases.keys()]) {
    if (source === closedKey || resolveTerminalAlias(aliases, source) === closedKey) {
      aliases.delete(source)
    }
  }
}

export function pruneTerminalAliasesForOwner(
  aliases: Map<TerminalKey, TerminalKey>,
  ownerKey: TerminalOwnerKey,
) {
  for (const source of [...aliases.keys()]) {
    const target = resolveTerminalAlias(aliases, source)
    if (
      ownerKeyFromTerminalKey(source) === ownerKey ||
      ownerKeyFromTerminalKey(target) === ownerKey
    ) {
      aliases.delete(source)
    }
  }
}
