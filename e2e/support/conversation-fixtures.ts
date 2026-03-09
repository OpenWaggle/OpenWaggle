import fs from 'node:fs/promises'
import path from 'node:path'

const CONVERSATION_DIRECTORY = 'conversations'
const INDEX_FILE_NAME = 'index.json'
const UTF_8_ENCODING: BufferEncoding = 'utf-8'
const FILE_WAIT_RETRY_DELAY_MS = 100
const FILE_WAIT_TIMEOUT_MS = 5_000
const CONVERSATION_INDEX_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

interface ConversationSummaryFixture {
  readonly id: string
  readonly title: string
  readonly projectPath: string | null
  readonly messageCount: number
  readonly archived?: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

function sortConversationSummaries(
  summaries: readonly ConversationSummaryFixture[],
): ConversationSummaryFixture[] {
  return [...summaries].sort((left, right) => right.updatedAt - left.updatedAt)
}

export interface SeedConversationInput {
  readonly title: string
  readonly updatedAt: number
  readonly messages: readonly unknown[]
  readonly projectPath?: string | null
  readonly archived?: boolean
}

export async function readConversationFiles(userDataDir: string): Promise<string[]> {
  const conversationsDir = path.join(userDataDir, CONVERSATION_DIRECTORY)
  const entries = await fs.readdir(conversationsDir)
  const files = entries.filter((entry) => entry.endsWith('.json') && entry !== INDEX_FILE_NAME)
  return files.sort().map((entry) => path.join(conversationsDir, entry))
}

export async function waitForConversationFiles(
  userDataDir: string,
  expectedCount: number,
): Promise<string[]> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < FILE_WAIT_TIMEOUT_MS) {
    const files = await readConversationFiles(userDataDir)
    if (files.length >= expectedCount) {
      return files
    }
    await new Promise((resolve) => setTimeout(resolve, FILE_WAIT_RETRY_DELAY_MS))
  }

  throw new Error(`Expected at least ${String(expectedCount)} conversation file(s)`)
}

export async function readSingleConversationFile(userDataDir: string): Promise<string> {
  const files = await waitForConversationFiles(userDataDir, 1)
  const firstFile = files[0]
  if (!firstFile) {
    throw new Error('Expected at least one conversation file')
  }
  return firstFile
}

export async function readConversationJson(userDataDir: string, filePath: string): Promise<unknown> {
  const rawConversation = await fs.readFile(filePath, UTF_8_ENCODING)
  const conversation: unknown = JSON.parse(rawConversation)
  if (!isRecord(conversation)) {
    throw new Error(`Conversation payload must be an object: ${filePath}`)
  }
  return conversation
}

export async function writeConversationJson(filePath: string, conversation: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), UTF_8_ENCODING)
}

export async function updateConversationIndex(
  userDataDir: string,
  conversationId: string,
  title: string,
  createdAt: number,
  updatedAt: number,
  messageCount: number,
  projectPath: string | null = null,
  archived?: boolean,
): Promise<void> {
  const indexPath = path.join(userDataDir, CONVERSATION_DIRECTORY, INDEX_FILE_NAME)
  const nextSummary: ConversationSummaryFixture = {
    id: conversationId,
    title,
    projectPath,
    messageCount,
    archived,
    createdAt,
    updatedAt,
  }

  let existingSummaries: ConversationSummaryFixture[] = []

  try {
    const raw = await fs.readFile(indexPath, UTF_8_ENCODING)
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed) && Array.isArray(parsed.conversations)) {
      existingSummaries = parsed.conversations.filter(isRecord).map((entry) => ({
        id: String(entry.id ?? ''),
        title: String(entry.title ?? ''),
        projectPath:
          typeof entry.projectPath === 'string' || entry.projectPath === null
            ? entry.projectPath
            : null,
        messageCount:
          typeof entry.messageCount === 'number' && Number.isFinite(entry.messageCount)
            ? entry.messageCount
            : 0,
        archived: typeof entry.archived === 'boolean' ? entry.archived : undefined,
        createdAt:
          typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
            ? entry.createdAt
            : createdAt,
        updatedAt:
          typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : updatedAt,
      }))
    }
  } catch {
    existingSummaries = []
  }

  const nextSummaries = sortConversationSummaries(
    [...existingSummaries.filter((entry) => entry.id !== conversationId), nextSummary],
  )

  await fs.writeFile(
    indexPath,
    JSON.stringify(
      {
        version: CONVERSATION_INDEX_VERSION,
        conversations: nextSummaries,
      },
      null,
      2,
    ),
    UTF_8_ENCODING,
  )
}

function getConversationCreatedAt(conversation: Record<string, unknown>, fallback: number): number {
  return typeof conversation.createdAt === 'number' ? conversation.createdAt : fallback
}

function getConversationProjectPath(
  conversation: Record<string, unknown>,
  nextProjectPath: string | null | undefined,
): string | null {
  if (nextProjectPath !== undefined) {
    return nextProjectPath
  }
  return typeof conversation.projectPath === 'string' || conversation.projectPath === null
    ? conversation.projectPath
    : null
}

export async function seedConversationFile(
  userDataDir: string,
  filePath: string,
  conversationInput: SeedConversationInput,
): Promise<void> {
  const existingConversation = await readConversationJson(userDataDir, filePath)
  if (!isRecord(existingConversation)) {
    throw new Error(`Conversation payload must be an object: ${filePath}`)
  }

  const createdAt = getConversationCreatedAt(existingConversation, conversationInput.updatedAt)
  const projectPath = getConversationProjectPath(
    existingConversation,
    conversationInput.projectPath,
  )
  const conversationId = path.basename(filePath, '.json')
  const nextConversation = {
    ...existingConversation,
    title: conversationInput.title,
    projectPath,
    archived: conversationInput.archived,
    updatedAt: conversationInput.updatedAt,
    messages: [...conversationInput.messages],
  }

  await writeConversationJson(filePath, nextConversation)
  await updateConversationIndex(
    userDataDir,
    conversationId,
    conversationInput.title,
    createdAt,
    conversationInput.updatedAt,
    conversationInput.messages.length,
    projectPath,
    conversationInput.archived,
  )
}

export async function seedSingleConversation(
  userDataDir: string,
  conversationInput: SeedConversationInput,
): Promise<void> {
  const filePath = await readSingleConversationFile(userDataDir)
  await seedConversationFile(userDataDir, filePath, conversationInput)
}

export async function seedConversations(
  userDataDir: string,
  conversationInputs: readonly SeedConversationInput[],
): Promise<void> {
  const filePaths = await waitForConversationFiles(userDataDir, conversationInputs.length)

  for (const [index, conversationInput] of conversationInputs.entries()) {
    const filePath = filePaths[index]
    if (!filePath) {
      throw new Error(`Expected conversation file at index ${String(index)}`)
    }
    await seedConversationFile(userDataDir, filePath, conversationInput)
  }
}
