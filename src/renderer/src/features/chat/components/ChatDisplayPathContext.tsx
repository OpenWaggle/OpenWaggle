import { createContext, type ReactNode, useContext } from 'react'
import {
  formatDisplayPathsInMarkdown,
  formatDisplayPathsInText,
  workspaceRelativePath,
} from '@/shared/lib/display-path'

const ChatProjectPathContext = createContext<string | null>(null)
const ChatWorktreePathContext = createContext<string | null>(null)

function useChatDisplayRoots() {
  const projectPath = useContext(ChatProjectPathContext)
  const worktreePath = useContext(ChatWorktreePathContext)
  return [worktreePath, projectPath].filter((root): root is string => root !== null)
}

export function ChatDisplayPathProvider({
  projectPath,
  worktreePath,
  children,
}: {
  readonly projectPath: string | null
  readonly worktreePath: string | null
  readonly children: ReactNode
}) {
  return (
    <ChatProjectPathContext value={projectPath}>
      <ChatWorktreePathContext value={worktreePath}>{children}</ChatWorktreePathContext>
    </ChatProjectPathContext>
  )
}

export function useChatDisplayText(text: string) {
  return formatDisplayPathsInText(text, useChatDisplayRoots())
}

export function useChatDisplayMarkdown(markdown: string) {
  return formatDisplayPathsInMarkdown(markdown, useChatDisplayRoots())
}

/** The workspace-relative path of a tool's file path, or null when it is outside the workspace. */
export function useChatWorkspaceRelativePath(path: string) {
  return workspaceRelativePath(path, useChatDisplayRoots())
}

export function useChatDisplayMarkdownFormatter() {
  const roots = useChatDisplayRoots()
  return (markdown: string) => formatDisplayPathsInMarkdown(markdown, roots)
}

export function useChatDisplayTextFormatter() {
  const roots = useChatDisplayRoots()
  return (text: string) => formatDisplayPathsInText(text, roots)
}
