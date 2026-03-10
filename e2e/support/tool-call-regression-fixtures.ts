import type { SeedConversationInput } from './conversation-fixtures'
import { seedConversations, seedSingleConversation } from './conversation-fixtures'
import { OpenWaggleApp } from './openwaggle-app'

export const REGRESSION_ASSISTANT_MODEL = 'claude-sonnet-4-5'
export const REGRESSION_THREAD_TITLE = 'Toolcall Regression'
export const REGRESSION_TOOL_PATH = 'lorem-ipsum.txt'
export const REGRESSION_TOOL_CONTENT = 'hello'
export const REGRESSION_USER_PROMPT = 'save it on the root of the project'
export const REGRESSION_RUNNING_LABEL = `Writing ${REGRESSION_TOOL_PATH}...`
export const REGRESSION_COMPLETED_LABEL = `Wrote ${REGRESSION_TOOL_PATH}`
export const REGRESSION_PENDING_LABEL = `Requested writeFile ${REGRESSION_TOOL_PATH}`

export function makeUserMessage(text: string, createdAt: number) {
  return {
    id: `user-msg-${String(createdAt)}`,
    role: 'user' as const,
    parts: [{ type: 'text' as const, text }],
    createdAt,
  }
}

export function makeAssistantMessage(parts: readonly unknown[], createdAt: number) {
  return {
    id: `assistant-msg-${String(createdAt)}`,
    role: 'assistant' as const,
    model: REGRESSION_ASSISTANT_MODEL,
    parts: [...parts],
    createdAt,
  }
}

export function makeWriteFileToolCallPart(
  id: string,
  path: string,
  content: string,
  options?: {
    readonly state?: 'approval-requested' | 'approval-responded'
    readonly approval?: {
      readonly id: string
      readonly needsApproval: boolean
      readonly approved?: boolean
    }
  },
) {
  return {
    type: 'tool-call' as const,
    toolCall: {
      id,
      name: 'writeFile',
      args: { path, content },
      state: options?.state,
      approval: options?.approval,
    },
  }
}

export function makeWriteFileToolResultPart(
  id: string,
  path: string,
  content: string,
  result: string,
  isError: boolean,
  duration = 0,
) {
  return {
    type: 'tool-result' as const,
    toolResult: {
      id,
      name: 'writeFile',
      args: { path, content },
      result,
      isError,
      duration,
    },
  }
}

export async function seedRegressionConversation(
  app: OpenWaggleApp,
  messages: readonly unknown[],
  options?: {
    readonly title?: string
    readonly updatedAt?: number
    readonly projectPath?: string | null
    readonly archived?: boolean
  },
): Promise<string> {
  const updatedAt = options?.updatedAt ?? Date.now()
  const title = options?.title ?? REGRESSION_THREAD_TITLE

  await seedSingleConversation(app.userDataDir, {
    title,
    updatedAt,
    messages,
    projectPath: options?.projectPath,
    archived: options?.archived,
  })

  return title
}

export async function restartAndOpenThread(app: OpenWaggleApp, title: string) {
  await app.restart()
  const mainWindow = app.mainWindow()
  await mainWindow.openThread(title)
  return mainWindow
}

export async function seedPendingApprovalConversations(
  userDataDir: string,
  conversations: readonly SeedConversationInput[],
): Promise<void> {
  await seedConversations(userDataDir, conversations)
}
