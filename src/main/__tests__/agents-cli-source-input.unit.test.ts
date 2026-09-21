import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_AGENT_DEFINITION_SOURCE_BYTES } from '../agents/agent-definition-source-reader'
import { runAgentsCli } from '../agents-cli'

const definition = `---
schemaVersion: 1
$schema: https://openwaggle.dev/schemas/agent-definition-v1.schema.json
name: boundary-reviewer
description: Reviews file boundaries
tools: [read_file]
---

Review file boundaries.
`

describe('Agent definitions CLI source input', () => {
  let root = ''
  let project = ''
  let home = ''
  let stdout: string[] = []
  let stderr: string[] = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agents-cli-source-'))
    project = path.join(root, 'project')
    home = path.join(root, 'home')
    await Promise.all([fs.mkdir(project), fs.mkdir(home)])
    stdout = []
    stderr = []
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  function run(args: readonly string[], readStdin?: () => Promise<string>) {
    return runAgentsCli(args, {
      cwd: project,
      home,
      stdout: (value) => {
        stdout.push(value)
      },
      stderr: (value) => {
        stderr.push(value)
      },
      ...(readStdin ? { readStdin } : {}),
      loadSemanticCatalog: async () => ({
        models: [],
        tools: ['read_file'],
        skills: [],
        mcpServers: [],
      }),
    })
  }

  it('keeps create, update, and validate working with regular files', async () => {
    const sourcePath = path.join(root, 'reviewer.md')
    await fs.writeFile(sourcePath, definition, 'utf8')

    await expect(run(['create', sourcePath, '--scope', 'project'])).resolves.toBe(0)
    await fs.writeFile(
      sourcePath,
      definition.replace('Reviews file boundaries', 'Reviews bounded file inputs'),
      'utf8',
    )
    await expect(run(['update', sourcePath, '--scope', 'project'])).resolves.toBe(0)
    await expect(run(['validate', sourcePath, '--json'])).resolves.toBe(0)

    expect(stderr).toEqual([])
    expect(stdout.join('')).toContain('boundary-reviewer')
  })

  it('accepts explicit stdin for create, update, and validate', async () => {
    await expect(run(['create', '-', '--scope', 'project'], async () => definition)).resolves.toBe(
      0,
    )
    await expect(
      run(['update', '-', '--scope', 'project'], async () =>
        definition.replace('Reviews file boundaries', 'Reviews bounded file inputs'),
      ),
    ).resolves.toBe(0)
    await expect(run(['validate', '-', '--json'], async () => definition)).resolves.toBe(0)
    expect(JSON.parse(stdout.at(-1) ?? '{}')).toMatchObject({
      result: {
        valid: true,
        name: 'boundary-reviewer',
        sourcePath: '<stdin>',
      },
    })
  })

  it('applies the file byte limit to stdin', async () => {
    await expect(
      run(['validate', '-', '--json'], async () =>
        'a'.repeat(MAX_AGENT_DEFINITION_SOURCE_BYTES + 1),
      ),
    ).resolves.toBe(1)
    expect(stderr.join('')).toContain('1 MiB size limit')
  })

  it('rejects oversized create, update, and validate files before parsing', async () => {
    const sourcePath = path.join(root, 'oversized.md')
    await fs.writeFile(sourcePath, '')
    await fs.truncate(sourcePath, MAX_AGENT_DEFINITION_SOURCE_BYTES + 1)

    for (const args of [
      ['create', sourcePath, '--scope', 'project'],
      ['update', sourcePath, '--scope', 'project'],
      ['validate', sourcePath],
    ]) {
      await expect(run(args)).resolves.toBe(1)
    }
    expect(stderr.join('')).toContain('1 MiB size limit')
  })

  it('rejects devices and FIFOs without waiting for a producer', async () => {
    if (process.platform === 'win32') return
    await expect(run(['validate', '/dev/null'])).resolves.toBe(1)
    expect(stderr.join('')).toContain('regular file')

    stderr = []
    const fifoPath = path.join(root, 'definition.fifo')
    expect(spawnSync('mkfifo', [fifoPath]).status).toBe(0)
    let producerStarted = false
    let producer: Promise<void> | undefined
    const producerTimer = setTimeout(() => {
      producerStarted = true
      producer = fs.writeFile(fifoPath, definition, 'utf8')
    }, 1_000)
    try {
      await expect(run(['validate', fifoPath])).resolves.toBe(1)
      expect(producerStarted).toBe(false)
      expect(stderr.join('')).toContain('regular file')
    } finally {
      clearTimeout(producerTimer)
      await producer
    }
  })
})
