import { createContext, type ReactNode, useContext } from 'react'
import {
  formatDisplayPathsInMarkdown,
  formatDisplayPathsInText,
  workspaceRelativePath,
} from '@/shared/lib/display-path'

const ChatProjectPathContext = createContext<string | null>(null)
const ChatWorktreePathContext = createContext<string | null>(null)
/** The root the workspace file view resolves relative paths against. */
const ChatWorkingPathContext = createContext<string | null>(null)

function useChatDisplayRoots() {
  const projectPath = useContext(ChatProjectPathContext)
  const worktreePath = useContext(ChatWorktreePathContext)
  return [worktreePath, projectPath].filter((root): root is string => root !== null)
}

export function ChatDisplayPathProvider({
  projectPath,
  worktreePath,
  workingPath = null,
  children,
}: {
  readonly projectPath: string | null
  readonly worktreePath: string | null
  /** Defaults to none, so no tool path is openable from the transcript. */
  readonly workingPath?: string | null
  readonly children: ReactNode
}) {
  return (
    <ChatProjectPathContext value={projectPath}>
      <ChatWorktreePathContext value={worktreePath}>
        <ChatWorkingPathContext value={workingPath}>{children}</ChatWorkingPathContext>
      </ChatWorktreePathContext>
    </ChatProjectPathContext>
  )
}

export function useChatDisplayText(text: string) {
  return formatDisplayPathsInText(text, useChatDisplayRoots())
}

export function useChatDisplayMarkdown(markdown: string) {
  return formatDisplayPathsInMarkdown(markdown, useChatDisplayRoots())
}

/**
 * The path of a tool's file path inside the Session's working root, or null when the
 * file view cannot open it there. Only the working root counts: in a worktree Session
 * a path under the project root names a different file than the worktree copy.
 */
export function useChatWorkspaceRelativePath(path: string) {
  return workspaceRelativePath(path, useContext(ChatWorkingPathContext))
}

export function useChatDisplayMarkdownFormatter() {
  const roots = useChatDisplayRoots()
  return (markdown: string) => formatDisplayPathsInMarkdown(markdown, roots)
}

export function useChatDisplayTextFormatter() {
  const roots = useChatDisplayRoots()
  return (text: string) => formatDisplayPathsInText(text, roots)
}
