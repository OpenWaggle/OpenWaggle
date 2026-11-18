import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_EMBEDDING_MODEL } from '../../src/main/adapters/multilingual-e5-session-embedding-model'
import { downloadVerifiedFile } from '../prepare-session-embedding-model'

const MODEL_CONTENT = 'verified model bytes'
const MODEL_HASH = createHash('sha256').update(MODEL_CONTENT).digest('hex')
const PINNED_PATH = `/${SESSION_EMBEDDING_MODEL.id}/resolve/${SESSION_EMBEDDING_MODEL.revision}/tokenizer.json`

describe('verified model downloads', () => {
  const originalDispatcher = getGlobalDispatcher()
  let agent: MockAgent
  let directory: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-model-download-test-'))
    agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)
  })

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher)
    try {
      await agent.close()
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('retries the same pinned URL and publishes only hash-verified bytes without temporary files', async () => {
    const pool = agent.get('https://huggingface.co')
    pool
      .intercept({ path: PINNED_PATH })
      .reply(429, 'rate limited', { headers: { 'retry-after': '1' } })
    pool.intercept({ path: PINNED_PATH }).reply(200, MODEL_CONTENT)

    await downloadVerifiedFile('tokenizer.json', MODEL_HASH, path.join(directory, 'tokenizer.json'))

    expect(await fs.readFile(path.join(directory, 'tokenizer.json'), 'utf8')).toBe(MODEL_CONTENT)
    expect(await fs.readdir(directory)).toEqual(['tokenizer.json'])
    agent.assertNoPendingInterceptors()
  })

  it('never retries an integrity mismatch or replaces an existing destination with unverified bytes', async () => {
    const destination = path.join(directory, 'tokenizer.json')
    await fs.writeFile(destination, 'previous verified content')
    agent.get('https://huggingface.co').intercept({ path: PINNED_PATH }).reply(200, 'wrong content')

    await expect(downloadVerifiedFile('tokenizer.json', MODEL_HASH, destination)).rejects.toThrow(
      'failed integrity verification',
    )

    expect(await fs.readFile(destination, 'utf8')).toBe('previous verified content')
    expect(await fs.readdir(directory)).toEqual(['tokenizer.json'])
    agent.assertNoPendingInterceptors()
  })

  it.each([403, 404, 204])(
    'leaves no destination or temporary file after HTTP %i failure',
    async (status) => {
      agent.get('https://huggingface.co').intercept({ path: PINNED_PATH }).reply(status, '')

      await expect(
        downloadVerifiedFile('tokenizer.json', MODEL_HASH, path.join(directory, 'tokenizer.json')),
      ).rejects.toThrow(status === 204 ? 'returned no body' : `HTTP ${status}`)

      expect(await fs.readdir(directory)).toEqual([])
      agent.assertNoPendingInterceptors()
    },
  )
})
