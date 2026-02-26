import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { DEFAULT_OPENAI_MODEL } from '@shared/types/settings'
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

vi.mock('../providers', () => ({
  providerRegistry: {
    isKnownModel: isKnownModelMock,
  },
}))

import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  saveConversation,
  updateConversationProjectPath,
  updateConversationTitle,
} from './conversations'

async function writeConversationFile(id: string, content: unknown): Promise<void> {
  const dir = path.join(state.userDataDir, 'conversations')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(content), 'utf-8')
}

function indexPath(): string {
  return path.join(state.userDataDir, 'conversations', 'index.json')
}

describe('conversation store integration', () => {
  beforeEach(async () => {
    state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-conversations-test-'))
    isKnownModelMock.mockReset()
    isKnownModelMock.mockReturnValue(false)
  })

  afterEach(async () => {
    if (state.userDataDir) {
      await fs.rm(state.userDataDir, { recursive: true, force: true })
    }
  })

  it('creates, saves, and reads conversations from disk', async () => {
    const created = await createConversation('/tmp/project-a')
    await updateConversationTitle(created.id, 'Updated title')

    const fetched = await getConversation(created.id)
    const summaries = await listConversations()

    expect(fetched?.title).toBe('Updated title')
    expect(fetched?.projectPath).toBe('/tmp/project-a')
    expect(summaries.some((summary) => summary.id === created.id)).toBe(true)
  })

  it('ignores malformed persisted files', async () => {
    await writeConversationFile('valid-conversation', {
      id: 'valid-conversation',
      title: 'Valid',
      projectPath: null,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    })

    const dir = path.join(state.userDataDir, 'conversations')
    await fs.writeFile(path.join(dir, 'broken.json'), '{not-json}', 'utf-8')

    const summaries = await listConversations()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.title).toBe('Valid')
  })

  it('migrates legacy and fallback model ids on load', async () => {
    await writeConversationFile('legacy-models', {
      id: 'legacy-models',
      title: 'Legacy',
      model: 'gpt-unknown-legacy',
      projectPath: null,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'first' }],
          createdAt: 100,
        },
        {
          id: 'm2',
          role: 'assistant',
          parts: [{ type: 'text', text: 'second' }],
          model: 'claude-sonnet-4-20250514',
          createdAt: 200,
        },
      ],
      createdAt: 10,
      updatedAt: 20,
    })

    const conversation = await getConversation(ConversationId('legacy-models'))

    expect(conversation?.messages[0]?.model).toBe(DEFAULT_OPENAI_MODEL)
    expect(conversation?.messages[1]?.model).toBe('claude-sonnet-4')
  })

  it('keeps known models unchanged during migration', async () => {
    isKnownModelMock.mockImplementation((modelId) => modelId === 'custom-model-v1')

    await writeConversationFile('known-model', {
      id: 'known-model',
      title: 'Known',
      projectPath: null,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'answer' }],
          model: 'custom-model-v1',
          createdAt: 1,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    })

    const conversation = await getConversation(ConversationId('known-model'))
    expect(conversation?.messages[0]?.model).toBe('custom-model-v1')
  })

  it('writes updatedAt when saving conversations', async () => {
    const conv = await createConversation('/tmp/project-b')
    const previousUpdatedAt = conv.updatedAt

    await saveConversation({ ...conv, title: 'Saved again' })
    const fetched = await getConversation(conv.id)

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

  it('creates and uses conversation index for listing', async () => {
    const created = await createConversation('/tmp/project-index')
    const first = await listConversations()

    expect(first.some((summary) => summary.id === created.id)).toBe(true)

    // Corrupt the conversation file; listing should still work from index.
    const convPath = path.join(state.userDataDir, 'conversations', `${created.id}.json`)
    await fs.writeFile(convPath, '{broken-json}', 'utf-8')

    const second = await listConversations()
    expect(second.some((summary) => summary.id === created.id)).toBe(true)
  })

  it('rebuilds index when index file is corrupt', async () => {
    const created = await createConversation('/tmp/project-rebuild')
    await listConversations()

    await fs.writeFile(indexPath(), '{not-valid-json}', 'utf-8')

    const summaries = await listConversations()
    expect(summaries.some((summary) => summary.id === created.id)).toBe(true)

    const repairedRaw = await fs.readFile(indexPath(), 'utf-8')
    const repaired: unknown = JSON.parse(repairedRaw)
    expect(typeof repaired).toBe('object')
    expect(repaired).toMatchObject({ version: 1 })
  })

  it('updates index on delete', async () => {
    const created = await createConversation('/tmp/project-delete')
    await listConversations()

    await deleteConversation(created.id)

    const summaries = await listConversations()
    expect(summaries.some((summary) => summary.id === created.id)).toBe(false)
  })
})
