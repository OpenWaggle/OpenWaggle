import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPiSessionPromptOrigins } from '../pi-session-prompt-origin'

let root = ''
let file = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-prompt-origin-'))
  file = path.join(root, 'session.jsonl')
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const header = { type: 'session', version: 3, id: 'session', timestamp: '', cwd: root }
const boundary = { type: 'custom', customType: 'openwaggle-run-boundary', data: { runId: 'r1' } }
const openWaggleInput = { type: 'custom', customType: 'openwaggle-user-input', data: {} }
const system = { type: 'message', message: { role: 'system', content: '' } }

function user(text: string) {
  return { type: 'message', message: { role: 'user', content: [{ type: 'text', text }] } }
}

function assistant(stopReason: 'stop' | 'toolUse') {
  return { type: 'message', message: { role: 'assistant', content: [], stopReason } }
}

const toolResult = { type: 'message', message: { role: 'toolResult', content: [] } }

function lines(entries: readonly unknown[]) {
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
}

async function write(entries: readonly unknown[]) {
  await fs.writeFile(file, lines(entries))
}

async function append(entries: readonly unknown[]) {
  await fs.appendFile(file, lines(entries))
}

describe('Pi session prompt origin', () => {
  it('reads a pi CLI session as written outside OpenWaggle', async () => {
    await write([header, system, user('From pi'), assistant('stop')])

    expect(await createPiSessionPromptOrigins().lastPromptOrigin(file)).toBe('outside')
  })

  it("reads an OpenWaggle Run's prompt, and a steer into its running turn, as OpenWaggle's", async () => {
    await write([
      header,
      boundary,
      system,
      openWaggleInput,
      user('From OpenWaggle'),
      assistant('toolUse'),
      toolResult,
      user('A steer while the tool ran'),
      assistant('stop'),
    ])

    expect(await createPiSessionPromptOrigins().lastPromptOrigin(file)).toBe('openwaggle')
  })

  it('notices a pi prompt appended after an OpenWaggle Run, and a later OpenWaggle Run', async () => {
    const origins = createPiSessionPromptOrigins()
    await write([header, boundary, openWaggleInput, user('From OpenWaggle'), assistant('stop')])
    expect(await origins.lastPromptOrigin(file)).toBe('openwaggle')

    await append([user('Continued in pi'), assistant('stop')])
    expect(await origins.lastPromptOrigin(file)).toBe('outside')

    await append([boundary, openWaggleInput, user('Back in OpenWaggle')])
    expect(await origins.lastPromptOrigin(file)).toBe('openwaggle')
  })

  it('reads a line still being written once it is complete', async () => {
    const origins = createPiSessionPromptOrigins()
    const piPrompt = JSON.stringify(user('From pi'))
    await write([header, boundary, openWaggleInput, user('From OpenWaggle')])
    await fs.appendFile(file, piPrompt.slice(0, 20))
    expect(await origins.lastPromptOrigin(file)).toBe('openwaggle')

    await fs.appendFile(file, `${piPrompt.slice(20)}\n`)
    expect(await origins.lastPromptOrigin(file)).toBe('outside')
  })

  it('has no origin for a file without prompts, or no file', async () => {
    await write([header, system])
    const origins = createPiSessionPromptOrigins()

    expect(await origins.lastPromptOrigin(file)).toBeNull()
    expect(await origins.lastPromptOrigin(path.join(root, 'missing.jsonl'))).toBeNull()
  })
})
