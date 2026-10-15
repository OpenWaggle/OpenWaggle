import {
  ArrowRightLeft,
  Binoculars,
  Box,
  CirclePlay,
  CodeXml,
  FilePenLine,
  FileText,
  FolderOpen,
  GitPullRequest,
  Goal,
  MousePointerClick,
  PencilLine,
  ScanSearch,
  Sparkles,
  Terminal,
} from 'lucide-react'
import type { ComponentPropsWithoutRef, ComponentType } from 'react'
import type { ToolKind } from '@/features/chat/lib/tool-kind'
import { McpIcon } from '@/shared/ui/icons/McpIcon'
import { RobotIcon } from '@/shared/ui/icons/RobotIcon'

type ToolKindIconComponent = ComponentType<ComponentPropsWithoutRef<'svg'>>

const TOOL_KIND_ICONS: Record<ToolKind, ToolKindIconComponent> = {
  subagents: RobotIcon,
  mcp: McpIcon,
  script: CodeXml,
  model: Sparkles,
  shell: Terminal,
  read: FileText,
  edit: FilePenLine,
  write: PencilLine,
  grep: ScanSearch,
  find: Binoculars,
  ls: FolderOpen,
  browser: MousePointerClick,
  actions: CirclePlay,
  scm: GitPullRequest,
  goals: Goal,
  waggle: ArrowRightLeft,
  other: Box,
}

/** The icon of a tool row's kind. Decorative: the row's text says what the tool did. */
export function ToolKindIcon({
  kind,
  className,
}: {
  readonly kind: ToolKind
  readonly className?: string
}) {
  const Icon = TOOL_KIND_ICONS[kind]
  return <Icon data-tool-kind={kind} className={className} />
}
