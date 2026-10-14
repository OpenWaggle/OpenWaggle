import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPiUsageCostScanner } from '../pi-usage-cost-scanner'

function sessionLine(id: string, cwd: string) {
  return `${JSON.stringify({ type: 'session', id, cwd, timestamp: '2026-10-14T08:00:00.000Z', version: 3 })}\n`
}

function modelChangeLine(provider: string, modelId: string, timestamp: string) {
  return `${JSON.stringify({ type: 'model_change', id: 'm1', parentId: null, timestamp, provider, modelId })}\n`
}

function assistantLine(
  timestamp: string,
  usage: Record<string, unknown>,
  model: Record<string, string> = { provider: 'anthropic', modelId: 'claude-opus-5-5' },
) {
  const message: Record<string, unknown> = {
    role: 'assistant',
    provider: model.provider,
    model: model.modelId,
    usage,
  }
  return `${JSON.stringify({ type: 'message', id: 'a1', parentId: null, timestamp, message })}\n`
}

function toolResultLine(timestamp: string, usage: Record<string, unknown>) {
  return `${JSON.stringify({ type: 'message', id: 't1', parentId: null, timestamp, message: { role: 'toolResult', usage } })}\n`
}

function boundaryLine() {
  return `${JSON.stringify({ type: 'custom', customType: 'openwaggle-run-boundary', data: { version: 1, runId: 'r1' }, id: 'c1', parentId: null, timestamp: '2026-10-14T08:00:01.000Z' })}\n`
}

async function writeSession(dir: string, name: string, lines: readonly string[]): Promise<string> {
  const file = path.join(dir, name)
  await writeFile(file, lines.join(''), 'utf8')
  return file
}

const ESTIMATOR = (_provider: string, modelId: string) =>
  modelId === 'unlisted-model' ? null : 0.01

describe('createPiUsageCostScanner', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir !== null) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('parses recorded costs, model attribution, and tool-result buckets from Pi session files', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'usage-cost-scan-'))
    const projectDir = path.join(tempDir, '--tmp-project--')
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      path.join(projectDir, '2026-10-14T08-00-00_a.jsonl'),
      [
        sessionLine('session-1', '/tmp/project'),
        boundaryLine(),
        modelChangeLine('anthropic', 'claude-opus-5-5', '2026-10-14T08:00:01.000Z'),
        assistantLine('2026-10-14T08:01:00.000Z', {
          input: 10,
          output: 20,
          cacheRead: 30,
          cacheWrite: 0,
          totalTokens: 60,
          cost: { total: 0.123 },
        }),
        assistantLine('2026-10-14T08:02:00.000Z', {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 3,
        }),
        toolResultLine('2026-10-14T08:02:30.000Z', {
          input: 5,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 5,
        }),
      ].join(''),
      'utf8',
    )

    const scanner = createPiUsageCostScanner({ sessionsRoot: tempDir, costEstimator: ESTIMATOR })
    const { sessions, stats } = await scanner.collectSessions({ rangeStartMs: null })

    expect(stats.scannedFiles).toBe(1)
    expect(sessions).toHaveLength(1)
    const session = sessions[0]
    expect(session?.sessionId).toBe('session-1')
    expect(session?.cwd).toBe('/tmp/project')
    expect(session?.origin).toBe('openwaggle')
    expect(session?.records).toHaveLength(3)
    expect(session?.records[0]).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-opus-5-5',
      recordedCostUsd: 0.123,
      estimatedCostUsd: null,
    })
    // No recorded cost and a model the estimator prices: Cost tier 2.
    expect(session?.records[1]).toMatchObject({ estimatedCostUsd: 0.01 })
    expect(session?.records[2]).toMatchObject({ provider: 'pi', modelId: 'tools/summaries' })
  })

  it('reuses the cache for unchanged files and re-parses changed ones', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'usage-cost-cache-'))
    const projectDir = path.join(tempDir, '--tmp-project--')
    await mkdir(projectDir, { recursive: true })
    const file = await writeSession(projectDir, '2026-10-14T08-00-00_a.jsonl', [
      sessionLine('session-1', '/tmp/project'),
      assistantLine('2026-10-14T08:01:00.000Z', {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
      }),
    ])

    const scanner = createPiUsageCostScanner({ sessionsRoot: tempDir, costEstimator: () => null })
    const first = await scanner.collectSessions({ rangeStartMs: null })
    expect(first.stats.scannedFilesCached).toBe(0)

    const second = await scanner.collectSessions({ rangeStartMs: null })
    expect(second.stats.scannedFilesCached).toBe(1)
    expect(second.sessions).toHaveLength(1)

    await writeFile(
      file,
      [
        sessionLine('session-1', '/tmp/project'),
        assistantLine('2026-10-14T08:01:00.000Z', {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
        }),
        assistantLine('2026-10-14T08:05:00.000Z', {
          input: 2,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 4,
        }),
      ].join(''),
      'utf8',
    )
    const future = new Date()
    await utimes(file, future, future)
    const third = await scanner.collectSessions({ rangeStartMs: null })
    expect(third.stats.scannedFilesCached).toBe(0)
    expect(third.sessions[0]?.records).toHaveLength(2)
  })

  it('skips files last modified before the range start', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'usage-cost-window-'))
    const projectDir = path.join(tempDir, '--tmp-project--')
    await mkdir(projectDir, { recursive: true })
    const file = await writeSession(projectDir, '2026-10-14T08-00-00_a.jsonl', [
      sessionLine('session-1', '/tmp/project'),
    ])
    const old = new Date('2026-10-01T00:00:00Z')
    await utimes(file, old, old)

    const scanner = createPiUsageCostScanner({ sessionsRoot: tempDir, costEstimator: () => null })
    const { sessions, stats } = await scanner.collectSessions({
      rangeStartMs: Date.parse('2026-10-10T00:00:00Z'),
    })
    expect(stats.scannedFiles).toBe(1)
    expect(sessions).toHaveLength(0)

    const all = await scanner.collectSessions({ rangeStartMs: null })
    expect(all.sessions).toHaveLength(1)
  })

  it('falls back to the last model_change when a message lacks model fields', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'usage-cost-model-'))
    const projectDir = path.join(tempDir, '--tmp-project--')
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      path.join(projectDir, '2026-10-14T08-00-00_a.jsonl'),
      [
        sessionLine('session-1', '/tmp/project'),
        modelChangeLine(
          'amazon-bedrock',
          'eu.anthropic.claude-opus-5-5',
          '2026-10-14T08:00:01.000Z',
        ),
        `${JSON.stringify({
          type: 'message',
          id: 'a2',
          parentId: null,
          timestamp: '2026-10-14T08:03:00.000Z',
          message: {
            role: 'assistant',
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          },
        })}\n`,
      ].join(''),
      'utf8',
    )

    const scanner = createPiUsageCostScanner({ sessionsRoot: tempDir, costEstimator: ESTIMATOR })
    const { sessions } = await scanner.collectSessions({ rangeStartMs: null })
    expect(sessions[0]?.records[0]).toMatchObject({
      provider: 'amazon-bedrock',
      modelId: 'eu.anthropic.claude-opus-5-5',
      estimatedCostUsd: 0.01,
    })
  })

  it('treats sessions without OpenWaggle entries as other Pi clients', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'usage-cost-origin-'))
    const projectDir = path.join(tempDir, '--tmp-project--')
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      path.join(projectDir, '2026-10-14T08-00-00_a.jsonl'),
      [
        sessionLine('session-1', '/tmp/project'),
        assistantLine('2026-10-14T08:01:00.000Z', {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
        }),
      ].join(''),
      'utf8',
    )

    const scanner = createPiUsageCostScanner({ sessionsRoot: tempDir, costEstimator: () => null })
    const { sessions } = await scanner.collectSessions({ rangeStartMs: null })
    expect(sessions[0]?.origin).toBe('other-pi-clients')
  })

  it('drops a partially written final line instead of failing the scan', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'usage-cost-partial-'))
    const projectDir = path.join(tempDir, '--tmp-project--')
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      path.join(projectDir, '2026-10-14T08-00-00_a.jsonl'),
      `${sessionLine('session-1', '/tmp/project')}${assistantLine('2026-10-14T08:01:00.000Z', {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
      })}{"type":"message","id":"cut`,
      'utf8',
    )

    const scanner = createPiUsageCostScanner({ sessionsRoot: tempDir, costEstimator: () => null })
    const { sessions } = await scanner.collectSessions({ rangeStartMs: null })
    expect(sessions[0]?.records).toHaveLength(1)
  })
})
