import type { JsonObject } from '@shared/types/json'
import {
  BookOpen,
  Camera,
  FileEdit,
  FilePlus,
  FileText,
  FolderTree,
  FormInput,
  Globe,
  type LucideIcon,
  MessageCircleQuestion,
  MousePointer,
  Search,
  Sparkles,
  Terminal,
  Type,
  Wrench,
  XCircle,
} from 'lucide-react'

interface ToolConfig {
  icon: LucideIcon
  displayName: string
  primaryArg: string
}

const TOOL_CONFIG: Record<string, ToolConfig> = {
  readFile: { icon: FileText, displayName: 'Read File', primaryArg: 'path' },
  writeFile: { icon: FilePlus, displayName: 'Write File', primaryArg: 'path' },
  editFile: { icon: FileEdit, displayName: 'Edit File', primaryArg: 'path' },
  runCommand: { icon: Terminal, displayName: 'Run Command', primaryArg: 'command' },
  glob: { icon: Search, displayName: 'Glob', primaryArg: 'pattern' },
  listFiles: { icon: FolderTree, displayName: 'List Files', primaryArg: 'path' },
  askUser: { icon: MessageCircleQuestion, displayName: 'Ask User', primaryArg: 'questions' },
  loadSkill: { icon: Sparkles, displayName: 'Load Skill', primaryArg: 'skillId' },
  loadAgents: { icon: BookOpen, displayName: 'Load Agents', primaryArg: '' },
  webFetch: { icon: Globe, displayName: 'Web Fetch', primaryArg: 'url' },
  browserNavigate: { icon: Globe, displayName: 'Navigate', primaryArg: 'url' },
  browserClick: { icon: MousePointer, displayName: 'Click', primaryArg: 'selector' },
  browserType: { icon: Type, displayName: 'Type', primaryArg: 'selector' },
  browserScreenshot: { icon: Camera, displayName: 'Screenshot', primaryArg: '' },
  browserExtractText: { icon: FileText, displayName: 'Extract Text', primaryArg: 'selector' },
  browserFillForm: { icon: FormInput, displayName: 'Fill Form', primaryArg: '' },
  browserClose: { icon: XCircle, displayName: 'Close Browser', primaryArg: '' },
}

const DEFAULT_CONFIG: ToolConfig = {
  icon: Wrench,
  displayName: 'Tool',
  primaryArg: '',
}

interface ToolVerbs {
  running: string
  completed: string
  approval: string
}

const TOOL_VERBS: Record<string, ToolVerbs> = {
  readFile: { running: 'Reading', completed: 'Read', approval: 'Read' },
  writeFile: { running: 'Writing', completed: 'Wrote', approval: 'Write' },
  editFile: { running: 'Editing', completed: 'Edited', approval: 'Edit' },
  runCommand: { running: 'Running', completed: 'Ran', approval: 'Run' },
  glob: { running: 'Searching', completed: 'Searched', approval: 'Search' },
  listFiles: { running: 'Listing', completed: 'Listed', approval: 'List' },
  loadSkill: { running: 'Loading skill', completed: 'Loaded skill', approval: 'Load skill' },
  loadAgents: { running: 'Loading agents', completed: 'Loaded agents', approval: 'Load agents' },
  webFetch: { running: 'Fetching', completed: 'Fetched', approval: 'Fetch' },
  browserNavigate: { running: 'Navigating to', completed: 'Navigated to', approval: 'Navigate to' },
  browserClick: { running: 'Clicking', completed: 'Clicked', approval: 'Click' },
  browserType: { running: 'Typing into', completed: 'Typed into', approval: 'Type into' },
  browserScreenshot: {
    running: 'Taking screenshot',
    completed: 'Took screenshot',
    approval: 'Take screenshot',
  },
  browserExtractText: {
    running: 'Extracting text',
    completed: 'Extracted text',
    approval: 'Extract text',
  },
  browserFillForm: { running: 'Filling form', completed: 'Filled form', approval: 'Fill form' },
  browserClose: {
    running: 'Closing browser',
    completed: 'Closed browser',
    approval: 'Close browser',
  },
}

export function getToolConfig(name: string): ToolConfig {
  return TOOL_CONFIG[name] ?? { ...DEFAULT_CONFIG, displayName: name }
}

export function getToolVerbs(name: string): ToolVerbs {
  return TOOL_VERBS[name] ?? { running: name, completed: name, approval: name }
}

export function getToolApprovalText(name: string, args: JsonObject): string {
  const verbs = getToolVerbs(name)
  const verb = verbs.approval
  const config = TOOL_CONFIG[name]

  if (!config) return verb

  const value = args[config.primaryArg]
  if (typeof value !== 'string') return verb

  if (name === 'runCommand') {
    return `${verb} \`${value}\``
  }

  return `${verb} ${value}`
}

export function getToolActionText(name: string, args: JsonObject, isRunning: boolean): string {
  const verbs = getToolVerbs(name)
  const verb = isRunning ? verbs.running : verbs.completed
  const config = TOOL_CONFIG[name]

  if (!config) return verb

  const value = args[config.primaryArg]
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
