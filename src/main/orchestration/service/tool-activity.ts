const TOOL_VERBS = {
  readFile: 'Read',
  writeFile: 'Wrote',
  editFile: 'Edited',
  runCommand: 'Ran',
  glob: 'Searched',
  listFiles: 'Listed',
  webFetch: 'Fetched',
} as const

const TOOL_PRIMARY_ARG = {
  readFile: 'path',
  writeFile: 'path',
  editFile: 'path',
  runCommand: 'command',
  glob: 'pattern',
  listFiles: 'path',
  webFetch: 'url',
} as const

function hasOwnKey<T extends object>(object: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(object, key)
}

export function formatToolActivity(
  toolName: string,
  toolInput: Readonly<JsonObject> | undefined,
): string | null {
  const verb = hasOwnKey(TOOL_VERBS, toolName) ? TOOL_VERBS[toolName] : toolName
  if (!toolInput) return null

  const argKey = hasOwnKey(TOOL_PRIMARY_ARG, toolName) ? TOOL_PRIMARY_ARG[toolName] : undefined
  const value = argKey ? toolInput[argKey] : undefined
  if (typeof value !== 'string') return null

  if (toolName === 'runCommand') return `${verb} \`${value}\``
  return `${verb} ${value}`
}

import type { JsonObject } from '@shared/types/json'
