import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPiUsageCostScanner } from '../pi-usage-cost-scanner'

function sessionLine(id: string, cwd: string) {
  return `${JSON.stringify({ type: 'session', id, cwd, timestamp: '2026-10-14T08:00:00.000Z', version: 3 })}\n`
}

function assistantLine(timestamp: string, usage: Record<string, unknown>) {
  const message = { role: 'assistant', provider: 'anthropic', model: 'claude-opus-5-5', usage }
  return `${JSON.stringify({ type: 'message', id: 'a1', parentId: null, timestamp, message })}\n`
}

function userLine(text: string, timestamp = '2026-10-14T08:00:30.000Z') {
  return `${JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp, message: { role: 'user', content: [{ type: 'text', text }] } })}\n`
}

function sessionInfoLine(name: string) {
  return `${JSON.stringify({ type: 'session_info', id: 'i1', parentId: null, timestamp: '2026-10-14T08:03:00.000Z', name })}\n`
}

async function writeSession(dir: string, name: string, lines: readonly string[]) {
  await writeFile(path.join(dir, name), lines.join(''), 'utf8')
}

const ESTIMATOR = () => 0.01

describe('Usage & Cost session titles', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir !== null) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('titles a session by its latest Pi name, else its first prompt, so rows can be told apart', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'usage-cost-title-'))
    const projectDir = path.join(tempDir, '--tmp-project--')
    await mkdir(projectDir, { recursive: true })
    const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }
    await writeSession(projectDir, '2026-10-14T08-00-00_a.jsonl', [
      sessionLine('named', '/tmp/project'),
      userLine('  Fix the\n flaky   checkout test  '),
      sessionInfoLine('Old name'),
      assistantLine('2026-10-14T08:01:00.000Z', usage),
      sessionInfoLine('Checkout flake'),
    ])
    await writeSession(projectDir, '2026-10-14T09-00-00_b.jsonl', [
      sessionLine('prompted', '/tmp/project'),
      userLine(`Review the release notes ${'x'.repeat(300)}`),
      assistantLine('2026-10-14T09:01:00.000Z', usage),
    ])
    await writeSession(projectDir, '2026-10-14T10-00-00_c.jsonl', [
      sessionLine('untitled', '/tmp/project'),
      assistantLine('2026-10-14T10:01:00.000Z', usage),
    ])

    const scanner = createPiUsageCostScanner({ sessionsRoot: tempDir, costEstimator: ESTIMATOR })
    const { sessions } = await scanner.collectSessions({ rangeStartMs: null })
    const titles = new Map(sessions.map((entry) => [entry.sessionId, entry.title]))

    expect(titles.get('named')).toBe('Checkout flake')
    const prompted = titles.get('prompted')
    expect(prompted?.startsWith('Review the release notes x')).toBe(true)
    expect(prompted?.length).toBeLessThanOrEqual(120)
    expect(titles.get('untitled')).toBeNull()
  })
})
