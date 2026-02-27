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
}

const TOOL_VERBS: Record<string, ToolVerbs> = {
  readFile: { running: 'Reading', completed: 'Read' },
  writeFile: { running: 'Writing', completed: 'Wrote' },
  editFile: { running: 'Editing', completed: 'Edited' },
  runCommand: { running: 'Running', completed: 'Ran' },
  glob: { running: 'Searching', completed: 'Searched' },
  listFiles: { running: 'Listing', completed: 'Listed' },
  loadSkill: { running: 'Loading skill', completed: 'Loaded skill' },
  loadAgents: { running: 'Loading agents', completed: 'Loaded agents' },
  webFetch: { running: 'Fetching', completed: 'Fetched' },
  browserNavigate: { running: 'Navigating to', completed: 'Navigated to' },
  browserClick: { running: 'Clicking', completed: 'Clicked' },
  browserType: { running: 'Typing into', completed: 'Typed into' },
  browserScreenshot: { running: 'Taking screenshot', completed: 'Took screenshot' },
  browserExtractText: { running: 'Extracting text', completed: 'Extracted text' },
  browserFillForm: { running: 'Filling form', completed: 'Filled form' },
  browserClose: { running: 'Closing browser', completed: 'Closed browser' },
}

export function getToolConfig(name: string): ToolConfig {
  return TOOL_CONFIG[name] ?? { ...DEFAULT_CONFIG, displayName: name }
}

export function getToolVerbs(name: string): ToolVerbs {
  return TOOL_VERBS[name] ?? { running: name, completed: name }
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
