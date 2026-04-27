import type { JsonObject } from '@shared/types/json'

type PiNativeToolName = 'read' | 'write' | 'edit' | 'bash' | 'grep' | 'find' | 'ls'

interface ToolDisplayEntry {
  readonly primaryArg: string
  readonly verbs: {
    readonly running: string
    readonly completed: string
  }
}

/**
 * Display metadata for Pi-native tools that OpenWaggle renders as UI.
 * Runtime tool availability still comes from Pi, not from this map.
 */
const PI_TOOL_DISPLAY: Record<PiNativeToolName, ToolDisplayEntry> = {
  read: {
    primaryArg: 'path',
    verbs: { running: 'Reading', completed: 'Read' },
  },
  write: {
    primaryArg: 'path',
    verbs: { running: 'Writing', completed: 'Wrote' },
  },
  edit: {
    primaryArg: 'path',
    verbs: { running: 'Editing', completed: 'Edited' },
  },
  bash: {
    primaryArg: 'command',
    verbs: { running: 'Running', completed: 'Ran' },
  },
  grep: {
    primaryArg: 'pattern',
    verbs: { running: 'Searching', completed: 'Searched' },
  },
  find: {
    primaryArg: 'pattern',
    verbs: { running: 'Finding', completed: 'Found' },
  },
  ls: {
    primaryArg: 'path',
    verbs: { running: 'Listing', completed: 'Listed' },
  },
}

function getDefaultEntry(name: string): ToolDisplayEntry {
  return {
    primaryArg: '',
    verbs: { running: name, completed: name },
  }
}

function isPiNativeToolName(name: string): name is PiNativeToolName {
  return name in PI_TOOL_DISPLAY
}

function getToolEntry(name: string): ToolDisplayEntry {
  if (isPiNativeToolName(name)) {
    return PI_TOOL_DISPLAY[name]
  }
  return getDefaultEntry(name)
}

function getToolActionText(name: string, args: JsonObject, isRunning: boolean): string {
  const entry = getToolEntry(name)
  const verb = isRunning ? entry.verbs.running : entry.verbs.completed
  const label = formatToolTarget(name, args, entry.primaryArg)

  if (!label) return isRunning ? `${verb}...` : verb
  if (isRunning && name === 'bash') return `${verb} ${label}`
  return isRunning ? `${verb} ${label}...` : `${verb} ${label}`
}

function formatToolTarget(name: string, args: JsonObject, primaryArg: string): string {
  if (name === 'bash' && typeof args.command === 'string') {
    return `\`${args.command}\``
  }

  if (name === 'read' && typeof args.path === 'string') {
    return `${args.path}${formatReadLineSuffix(args)}`
  }

  if (name === 'grep' && typeof args.pattern === 'string') {
    const path = typeof args.path === 'string' && args.path ? args.path : '.'
    const glob = typeof args.glob === 'string' && args.glob ? ` (${args.glob})` : ''
    return `/${args.pattern}/ in ${path}${glob}`
  }

  if (name === 'find' && typeof args.pattern === 'string') {
    const path = typeof args.path === 'string' && args.path ? args.path : '.'
    return `${args.pattern} in ${path}`
  }

  if (name === 'ls') {
    const path = typeof args.path === 'string' && args.path ? args.path : '.'
    return path
  }

  const value = args[primaryArg]
  return typeof value === 'string' ? value : ''
}

function formatReadLineSuffix(args: JsonObject): string {
  const offset = typeof args.offset === 'number' ? args.offset : undefined
  const limit = typeof args.limit === 'number' ? args.limit : undefined
  if (offset === undefined && limit === undefined) {
    return ''
  }

  const startLine = offset ?? 1
  if (limit === undefined) {
    return `:${String(startLine)}`
  }

  return `:${String(startLine)}-${String(startLine + limit - 1)}`
}

interface ActionTextParams {
  readonly name: string
  readonly args: JsonObject
  readonly awaitingResult: boolean
  readonly isError: boolean
  readonly isRunning: boolean
}

export function resolveActionText(params: ActionTextParams): string {
  if (params.awaitingResult) {
    return formatStatusActionText('Requested', params.name, params.args)
  }
  if (params.isError) {
    return formatStatusActionText('Failed', params.name, params.args)
  }
  return getToolActionText(params.name, params.args, params.isRunning)
}

function formatStatusActionText(prefix: string, name: string, args: JsonObject): string {
  if (typeof args.path === 'string') {
    return `${prefix} ${name} ${args.path}`
  }
  if (name === 'bash' && typeof args.command === 'string') {
    return `${prefix} ${name} \`${args.command}\``
  }
  return `${prefix} ${name}`
}
