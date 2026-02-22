import {
  BookOpen,
  FileEdit,
  FilePlus,
  FileText,
  FolderTree,
  type LucideIcon,
  MessageCircleQuestion,
  Search,
  Sparkles,
  Terminal,
  Wrench,
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
}

export function getToolConfig(name: string): ToolConfig {
  return TOOL_CONFIG[name] ?? { ...DEFAULT_CONFIG, displayName: name }
}

export function getToolSummary(name: string, args: Record<string, unknown>): string | null {
  const config = TOOL_CONFIG[name]
  if (!config) return null
  const value = args[config.primaryArg]
  if (typeof value === 'string') return value
  return null
}

export function getToolVerbs(name: string): ToolVerbs {
  return TOOL_VERBS[name] ?? { running: name, completed: name }
}

export function getToolActionText(
  name: string,
  args: Record<string, unknown>,
  isRunning: boolean,
): string {
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
