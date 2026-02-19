import {
  FileEdit,
  FilePlus,
  FileText,
  FolderTree,
  type LucideIcon,
  Search,
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
}

const DEFAULT_CONFIG: ToolConfig = {
  icon: Wrench,
  displayName: 'Tool',
  primaryArg: '',
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
