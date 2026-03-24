import type { JsonObject } from '@shared/types/json'
import {
  BookOpen,
  Camera,
  CheckSquare,
  ClipboardList,
  FileEdit,
  FilePlus,
  FileText,
  FolderTree,
  FormInput,
  Globe,
  type LucideIcon,
  MessageCircleQuestion,
  MousePointer,
  Network,
  Search,
  Send,
  Sparkles,
  SquarePen,
  Terminal,
  Trash2,
  Type,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react'
import type { BuiltInToolName } from '../../../main/tools/built-in-tools'

interface ToolDisplayEntry {
  readonly icon: LucideIcon
  readonly displayName: string
  readonly primaryArg: string
  readonly verbs: {
    readonly running: string
    readonly completed: string
    readonly approval: string
  }
}

/**
 * Display metadata for every built-in tool. Keyed by `BuiltInToolName` —
 * TypeScript enforces that every built-in tool has an entry and rejects
 * typos or stale keys.
 */
const BUILT_IN_TOOL_DISPLAY: Record<BuiltInToolName, ToolDisplayEntry> = {
  readFile: {
    icon: FileText,
    displayName: 'Read File',
    primaryArg: 'path',
    verbs: { running: 'Reading', completed: 'Read', approval: 'Read' },
  },
  writeFile: {
    icon: FilePlus,
    displayName: 'Write File',
    primaryArg: 'path',
    verbs: { running: 'Writing', completed: 'Wrote', approval: 'Write' },
  },
  editFile: {
    icon: FileEdit,
    displayName: 'Edit File',
    primaryArg: 'path',
    verbs: { running: 'Editing', completed: 'Edited', approval: 'Edit' },
  },
  runCommand: {
    icon: Terminal,
    displayName: 'Run Command',
    primaryArg: 'command',
    verbs: { running: 'Running', completed: 'Ran', approval: 'Run' },
  },
  glob: {
    icon: Search,
    displayName: 'Glob',
    primaryArg: 'pattern',
    verbs: { running: 'Searching', completed: 'Searched', approval: 'Search' },
  },
  listFiles: {
    icon: FolderTree,
    displayName: 'List Files',
    primaryArg: 'path',
    verbs: { running: 'Listing', completed: 'Listed', approval: 'List' },
  },
  askUser: {
    icon: MessageCircleQuestion,
    displayName: 'Ask User',
    primaryArg: 'questions',
    verbs: { running: 'Asking', completed: 'Asked', approval: 'Ask' },
  },
  loadSkill: {
    icon: Sparkles,
    displayName: 'Load Skill',
    primaryArg: 'skillId',
    verbs: { running: 'Loading skill', completed: 'Loaded skill', approval: 'Load skill' },
  },
  loadAgents: {
    icon: BookOpen,
    displayName: 'Load Agents',
    primaryArg: '',
    verbs: { running: 'Loading agents', completed: 'Loaded agents', approval: 'Load agents' },
  },
  webFetch: {
    icon: Globe,
    displayName: 'Web Fetch',
    primaryArg: 'url',
    verbs: { running: 'Fetching', completed: 'Fetched', approval: 'Fetch' },
  },
  proposePlan: {
    icon: SquarePen,
    displayName: 'Propose Plan',
    primaryArg: '',
    verbs: { running: 'Planning', completed: 'Planned', approval: 'Plan' },
  },
  orchestrate: {
    icon: Network,
    displayName: 'Orchestrate',
    primaryArg: '',
    verbs: { running: 'Orchestrating', completed: 'Orchestrated', approval: 'Orchestrate' },
  },
  spawnAgent: {
    icon: Users,
    displayName: 'Spawn Agent',
    primaryArg: '',
    verbs: { running: 'Spawning agent', completed: 'Spawned agent', approval: 'Spawn agent' },
  },
  sendMessage: {
    icon: Send,
    displayName: 'Send Message',
    primaryArg: '',
    verbs: { running: 'Sending message', completed: 'Sent message', approval: 'Send message' },
  },
  taskCreate: {
    icon: ClipboardList,
    displayName: 'Create Task',
    primaryArg: '',
    verbs: { running: 'Creating task', completed: 'Created task', approval: 'Create task' },
  },
  taskGet: {
    icon: ClipboardList,
    displayName: 'Get Task',
    primaryArg: '',
    verbs: { running: 'Getting task', completed: 'Got task', approval: 'Get task' },
  },
  taskList: {
    icon: ClipboardList,
    displayName: 'List Tasks',
    primaryArg: '',
    verbs: { running: 'Listing tasks', completed: 'Listed tasks', approval: 'List tasks' },
  },
  taskUpdate: {
    icon: CheckSquare,
    displayName: 'Update Task',
    primaryArg: '',
    verbs: { running: 'Updating task', completed: 'Updated task', approval: 'Update task' },
  },
  teamCreate: {
    icon: Users,
    displayName: 'Create Team',
    primaryArg: '',
    verbs: { running: 'Creating team', completed: 'Created team', approval: 'Create team' },
  },
  teamDelete: {
    icon: Trash2,
    displayName: 'Delete Team',
    primaryArg: '',
    verbs: { running: 'Deleting team', completed: 'Deleted team', approval: 'Delete team' },
  },
}

const KNOWN_MCP_TOOL_NAMES = [
  'browserNavigate',
  'browserClick',
  'browserType',
  'browserScreenshot',
  'browserExtractText',
  'browserFillForm',
  'browserClose',
] as const

type KnownMcpToolName = (typeof KNOWN_MCP_TOOL_NAMES)[number]

/** Display entries for known MCP tools (e.g. Playwright browser tools). */
const MCP_TOOL_DISPLAY: Record<KnownMcpToolName, ToolDisplayEntry> = {
  browserNavigate: {
    icon: Globe,
    displayName: 'Navigate',
    primaryArg: 'url',
    verbs: { running: 'Navigating to', completed: 'Navigated to', approval: 'Navigate to' },
  },
  browserClick: {
    icon: MousePointer,
    displayName: 'Click',
    primaryArg: 'selector',
    verbs: { running: 'Clicking', completed: 'Clicked', approval: 'Click' },
  },
  browserType: {
    icon: Type,
    displayName: 'Type',
    primaryArg: 'selector',
    verbs: { running: 'Typing into', completed: 'Typed into', approval: 'Type into' },
  },
  browserScreenshot: {
    icon: Camera,
    displayName: 'Screenshot',
    primaryArg: '',
    verbs: {
      running: 'Taking screenshot',
      completed: 'Took screenshot',
      approval: 'Take screenshot',
    },
  },
  browserExtractText: {
    icon: FileText,
    displayName: 'Extract Text',
    primaryArg: 'selector',
    verbs: { running: 'Extracting text', completed: 'Extracted text', approval: 'Extract text' },
  },
  browserFillForm: {
    icon: FormInput,
    displayName: 'Fill Form',
    primaryArg: '',
    verbs: { running: 'Filling form', completed: 'Filled form', approval: 'Fill form' },
  },
  browserClose: {
    icon: XCircle,
    displayName: 'Close Browser',
    primaryArg: '',
    verbs: {
      running: 'Closing browser',
      completed: 'Closed browser',
      approval: 'Close browser',
    },
  },
}

function getDefaultEntry(name: string): ToolDisplayEntry {
  return {
    icon: Wrench,
    displayName: name,
    primaryArg: '',
    verbs: { running: name, completed: name, approval: name },
  }
}

function isBuiltInToolName(name: string): name is BuiltInToolName {
  return name in BUILT_IN_TOOL_DISPLAY
}

function isKnownMcpToolName(name: string): name is KnownMcpToolName {
  return name in MCP_TOOL_DISPLAY
}

function getToolEntry(name: string): ToolDisplayEntry {
  if (isBuiltInToolName(name)) {
    return BUILT_IN_TOOL_DISPLAY[name]
  }
  if (isKnownMcpToolName(name)) {
    return MCP_TOOL_DISPLAY[name]
  }
  return getDefaultEntry(name)
}

export function getToolConfig(
  name: string,
): Pick<ToolDisplayEntry, 'icon' | 'displayName' | 'primaryArg'> {
  return getToolEntry(name)
}

export function getToolVerbs(name: string): ToolDisplayEntry['verbs'] {
  return getToolEntry(name).verbs
}

export function getToolApprovalText(name: string, args: JsonObject): string {
  const entry = getToolEntry(name)
  const verb = entry.verbs.approval

  const value = args[entry.primaryArg]
  if (typeof value !== 'string') return verb

  if (name === 'runCommand') {
    return `${verb} \`${value}\``
  }

  return `${verb} ${value}`
}

export function getToolActionText(name: string, args: JsonObject, isRunning: boolean): string {
  const entry = getToolEntry(name)
  const verb = isRunning ? entry.verbs.running : entry.verbs.completed

  const value = args[entry.primaryArg]
  if (typeof value !== 'string') return isRunning ? `${verb}...` : verb

  if (name === 'runCommand') {
    return `${verb} \`${value}\``
  }

  return isRunning ? `${verb} ${value}...` : `${verb} ${value}`
}

export interface ActionTextParams {
  readonly name: string
  readonly args: JsonObject
  readonly awaitingApproval: boolean
  readonly awaitingResult: boolean
  readonly isError: boolean
  readonly isRunning: boolean
}

export function resolveActionText(params: ActionTextParams): string {
  if (params.awaitingApproval) {
    return getToolApprovalText(params.name, params.args)
  }
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
  if (name === 'runCommand' && typeof args.command === 'string') {
    return `${prefix} ${name} \`${args.command}\``
  }
  return `${prefix} ${name}`
}
