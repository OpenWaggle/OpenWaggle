import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { ConversationId } from '@shared/types/brand'
import { DEFAULT_OPENAI_MODEL } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { state, isKnownModelMock, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  isKnownModelMock: vi.fn<(modelId: string) => boolean>(() => false),
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
}))

vi.mock('../../providers', () => ({
  providerRegistry: {
    isKnownModel: isKnownModelMock,
  },
}))

import { resetAppRuntimeForTests, runAppEffect } from '../../runtime'
import {
  archiveConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listArchivedConversations,
  listConversations,
  saveConversation,
  unarchiveConversation,
  updateConversationProjectPath,
  updateConversationTitle,
} from '../conversations'

interface SeedConversationOptions {
  readonly id: string
  readonly title: string
  readonly projectPath: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly model?: string
  readonly archived?: boolean
  readonly messages?: ReadonlyArray<{
    readonly id: string
    readonly role: 'user' | 'assistant'
    readonly model?: string
    readonly createdAt: number
    readonly metadataJson?: string
    readonly parts: ReadonlyArray<{
      readonly type: string
      readonly content: Record<string, unknown>
    }>
  }>
}

async function seedConversation(options: SeedConversationOptions): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO conversations (
              id,
              title,
              model,
              project_path,
              archived,
              waggle_config_json,
              created_at,
              updated_at
            )
            VALUES (
              ${options.id},
              ${options.title},
              ${options.model ?? null},
              ${options.projectPath},
              ${options.archived ? 1 : 0},
              ${null},
              ${options.createdAt},
              ${options.updatedAt}
            )
          `

          for (const [messageIndex, message] of (options.messages ?? []).entries()) {
            yield* sql`
              INSERT INTO conversation_messages (
                id,
                conversation_id,
                role,
                model,
                metadata_json,
                created_at,
                position
              )
              VALUES (
                ${message.id},
                ${options.id},
                ${message.role},
                ${message.model ?? null},
                ${message.metadataJson ?? null},
                ${message.createdAt},
                ${messageIndex}
              )
            `

            for (const [partIndex, part] of message.parts.entries()) {
              yield* sql`
                INSERT INTO conversation_message_parts (
                  id,
                  message_id,
                  part_type,
                  content_json,
                  position
                )
                VALUES (
                  ${`${message.id}:part:${String(partIndex)}`},
                  ${message.id},
                  ${part.type},
                  ${JSON.stringify(part.content)},
                  ${partIndex}
                )
              `
            }
          }
        }),
      )
    }),
  )
}

async function readArchivedValue(id: string): Promise<number | undefined> {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ archived: number }>`
        SELECT archived
        FROM conversations
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0]?.archived
    }),
  )
}

async function countMessagePartsForConversation(id: string): Promise<number> {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ count: number }>`
        SELECT COUNT(cmp.id) AS count
        FROM conversation_message_parts cmp
        INNER JOIN conversation_messages cm ON cm.id = cmp.message_id
        WHERE cm.conversation_id = ${id}
      `
      return rows[0]?.count ?? 0
    }),
  )
}

describe('conversation store integration', () => {
  beforeEach(async () => {
    await resetAppRuntimeForTests()
    state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-conversations-test-'))
    isKnownModelMock.mockReset()
    isKnownModelMock.mockReturnValue(false)
  })

  afterEach(async () => {
    await resetAppRuntimeForTests()
    if (state.userDataDir) {
      await fs.rm(state.userDataDir, { recursive: true, force: true })
    }
  })

  it('creates, saves, and reads conversations from SQLite', async () => {
    const created = await createConversation('/tmp/project-a')
    await updateConversationTitle(created.id, 'Updated title')

    const fetched = await getConversation(created.id)
    const summaries = await listConversations()

    expect(fetched?.title).toBe('Updated title')
    expect(fetched?.projectPath).toBe('/tmp/project-a')
    expect(summaries.some((summary) => summary.id === created.id)).toBe(true)
  })

  it('lists valid conversation summaries even when one message payload is malformed', async () => {
    await seedConversation({
      id: 'valid-conversation',
      title: 'Valid',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          createdAt: 1,
          parts: [{ type: 'text', content: { text: 'hello' } }],
        },
      ],
    })

    await seedConversation({
      id: 'broken-conversation',
      title: 'Broken',
      projectPath: null,
      createdAt: 2,
      updatedAt: 2,
      messages: [
        {
          id: 'm2',
          role: 'assistant',
          createdAt: 2,
          parts: [{ type: 'tool-call', content: { unexpected: true } }],
        },
      ],
    })

    const summaries = await listConversations()
    expect(summaries.map((summary) => summary.id)).toEqual(
      expect.arrayContaining(['valid-conversation', 'broken-conversation']),
    )
    await expect(getConversation(ConversationId('broken-conversation'))).resolves.toBeNull()
  })

  it('migrates legacy and fallback model ids on load', async () => {
    await seedConversation({
      id: 'legacy-models',
      title: 'Legacy',
      model: 'gpt-unknown-legacy',
      projectPath: null,
      createdAt: 10,
      updatedAt: 20,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          createdAt: 100,
          parts: [{ type: 'text', content: { text: 'first' } }],
        },
        {
          id: 'm2',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          createdAt: 200,
          parts: [{ type: 'text', content: { text: 'second' } }],
        },
      ],
    })

    const conversation = await getConversation(ConversationId('legacy-models'))

    expect(conversation?.messages[0]?.model).toBe(DEFAULT_OPENAI_MODEL)
    expect(conversation?.messages[1]?.model).toBe('claude-sonnet-4')
  })

  it('normalizes legacy thinking parts to reasoning on load', async () => {
    await seedConversation({
      id: 'legacy-thinking-part',
      title: 'Legacy thinking',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          createdAt: 1,
          parts: [{ type: 'thinking', content: { text: 'Legacy chain of thought' } }],
        },
      ],
    })

    const conversation = await getConversation(ConversationId('legacy-thinking-part'))
    expect(conversation?.messages[0]?.parts[0]).toEqual({
      type: 'reasoning',
      text: 'Legacy chain of thought',
    })
  })

  it('keeps known models unchanged during migration', async () => {
    isKnownModelMock.mockImplementation((modelId) => modelId === 'custom-model-v1')

    await seedConversation({
      id: 'known-model',
      title: 'Known',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          model: 'custom-model-v1',
          createdAt: 1,
          parts: [{ type: 'text', content: { text: 'answer' } }],
        },
      ],
    })

    const conversation = await getConversation(ConversationId('known-model'))
    expect(conversation?.messages[0]?.model).toBe('custom-model-v1')
  })

  it('writes updatedAt when saving conversations', async () => {
    const conversation = await createConversation('/tmp/project-b')
    const previousUpdatedAt = conversation.updatedAt

    await saveConversation({ ...conversation, title: 'Saved again' })
    const fetched = await getConversation(conversation.id)

    expect(fetched?.title).toBe('Saved again')
    expect((fetched?.updatedAt ?? 0) >= previousUpdatedAt).toBe(true)
  })

  it('updates project path for an existing conversation', async () => {
    const conversation = await createConversation('/tmp/project-c')
    const updated = await updateConversationProjectPath(conversation.id, '/tmp/project-d')

    expect(updated?.projectPath).toBe('/tmp/project-d')

    const reloaded = await getConversation(conversation.id)
    expect(reloaded?.projectPath).toBe('/tmp/project-d')
  })

  it('deletes conversations and cascades message part rows', async () => {
    await seedConversation({
      id: 'cascade-delete',
      title: 'Cascade',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          createdAt: 1,
          parts: [
            { type: 'text', content: { text: 'one' } },
            { type: 'reasoning', content: { text: 'two' } },
          ],
        },
      ],
    })

    expect(await countMessagePartsForConversation('cascade-delete')).toBe(2)

    await deleteConversation(ConversationId('cascade-delete'))

    expect(await countMessagePartsForConversation('cascade-delete')).toBe(0)
    await expect(getConversation(ConversationId('cascade-delete'))).resolves.toBeNull()
  })

  it('archives a conversation and excludes it from active listing', async () => {
    const conversation = await createConversation('/tmp/project-archive')

    await archiveConversation(conversation.id)

    const active = await listConversations()
    expect(active.some((summary) => summary.id === conversation.id)).toBe(false)

    const archived = await listArchivedConversations()
    expect(archived.some((summary) => summary.id === conversation.id)).toBe(true)
    expect(archived.find((summary) => summary.id === conversation.id)?.archived).toBe(true)
  })

  it('unarchives a conversation and returns it to active listing', async () => {
    const conversation = await createConversation('/tmp/project-unarchive')

    await archiveConversation(conversation.id)
    await unarchiveConversation(conversation.id)

    const active = await listConversations()
    expect(active.some((summary) => summary.id === conversation.id)).toBe(true)

    const archived = await listArchivedConversations()
    expect(archived.some((summary) => summary.id === conversation.id)).toBe(false)
  })

  it('persists archived flag to SQLite', async () => {
    const conversation = await createConversation('/tmp/project-persist-archive')

    await archiveConversation(conversation.id)

    const reloaded = await getConversation(conversation.id)
    expect(reloaded?.archived).toBe(true)
    expect(await readArchivedValue(conversation.id)).toBe(1)
  })

  it('applies optional listing limit', async () => {
    await createConversation('/tmp/project-limit-a')
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
    await createConversation('/tmp/project-limit-b')

    const all = await listConversations()
    const limited = await listConversations(1)

    expect(all.length).toBeGreaterThanOrEqual(2)
    expect(limited).toHaveLength(1)
    expect(limited[0]?.id).toBe(all[0]?.id)
  })
})
