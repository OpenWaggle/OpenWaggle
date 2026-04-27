import type { SeedConversationInput } from './conversation-fixtures'
import { seedConversations, seedSingleConversation } from './conversation-fixtures'
import { OpenWaggleApp } from './openwaggle-app'

export const REGRESSION_ASSISTANT_MODEL = 'openai-codex/gpt-5.5'
export const REGRESSION_THREAD_TITLE = 'Toolcall Regression'
export const REGRESSION_TOOL_PATH = 'lorem-ipsum.txt'
export const REGRESSION_TOOL_CONTENT = 'hello'
export const REGRESSION_USER_PROMPT = 'save it on the root of the project'
export const REGRESSION_RUNNING_LABEL = `Writing ${REGRESSION_TOOL_PATH}...`
export const REGRESSION_COMPLETED_LABEL = `Wrote ${REGRESSION_TOOL_PATH}`
export const REGRESSION_PENDING_LABEL = `Requested write ${REGRESSION_TOOL_PATH}`

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

export function makeWriteToolCallPart(id: string, path: string, content: string) {
  return {
    type: 'tool-call' as const,
    toolCall: {
      id,
      name: 'write',
      args: { path, content },
      state: 'input-complete' as const,
    },
  }
}

export function makeWriteToolResultPart(
  id: string,
  path: string,
  content: string,
  result: unknown,
  isError: boolean,
  duration = 0,
) {
  return {
    type: 'tool-result' as const,
    toolResult: {
      id,
      name: 'write',
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
): Promise<string> {
  const title = `${REGRESSION_THREAD_TITLE} ${Date.now().toString(36).slice(-6)}`
  await seedSingleConversation(app.userDataDir, {
    title,
    updatedAt: Date.now(),
    messages,
  })
  return title
}

export async function seedToolStateConversations(
  userDataDir: string,
  conversations: readonly SeedConversationInput[],
): Promise<void> {
  await seedConversations(userDataDir, conversations)
}

export async function restartAndOpenThread(app: OpenWaggleApp, title: string) {
  await app.restart()
  const mainWindow = app.mainWindow()
  await mainWindow.openThread(title)
  return mainWindow
}
