import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createCompactionProviderProbe } from '../qa/compaction-provider-probe'

it('independently holds compaction and continuation until their explicit releases', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-compaction-probe-'))
  const piAgentDir = path.join(directory, 'pi-agent')
  const probe = await createCompactionProviderProbe(piAgentDir, directory)
  const request = () =>
    fetch(`${probe.baseUrl}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'continue' }] }),
    })
  try {
    expect(() => probe.releaseCompaction()).toThrow('Pi has not requested compaction yet.')
    expect(() => probe.releaseContinuation()).toThrow('Pi has not requested continuation yet.')
    const configuration: unknown = JSON.parse(
      await fs.readFile(path.join(piAgentDir, 'models.json'), 'utf8'),
    )
    expect(configuration).toMatchObject({
      providers: { 'e2e-compaction': { baseUrl: probe.baseUrl, api: 'openai-completions' } },
    })
    expect(await (await request()).text()).toContain('"prompt_tokens":90000')
    let compactionDelivered = false
    const compaction = request().then(async (response) => {
      const text = await response.text()
      compactionDelivered = true
      return text
    })
    await expect.poll(probe.compactionPending).toBe(true)
    expect(compactionDelivered).toBe(false)
    expect(probe.requests).toHaveLength(2)
    expect(probe.continuationPending()).toBe(false)
    probe.releaseCompaction()
    expect(await compaction).toContain('Kept the active task context.')
    expect(probe.compactionPending()).toBe(false)
    let continuationDelivered = false
    const continuation = request().then(async (response) => {
      const text = await response.text()
      continuationDelivered = true
      return text
    })
    await expect.poll(probe.continuationPending).toBe(true)
    expect(continuationDelivered).toBe(false)
    expect(probe.requests).toHaveLength(3)
    expect(() => probe.releaseCompaction()).toThrow('Pi has not requested compaction yet.')
    expect(continuationDelivered).toBe(false)
    probe.releaseContinuation()
    expect(await continuation).toContain('Resumed the original request after compaction.')
    expect(probe.continuationPending()).toBe(false)
    expect(() => probe.releaseContinuation()).toThrow('Pi has not requested continuation yet.')
    expect(await (await request()).text()).toContain('"prompt_tokens":100')
    expect(probe.requests).toHaveLength(4)
  } finally {
    await probe.close()
    await fs.rm(directory, { recursive: true, force: true })
  }
})
