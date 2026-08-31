import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseAgentDefinition } from '../agents/agent-definition-parser'
import { runAgentsCli } from '../agents-cli'

const definition = `---
schemaVersion: 1
$schema: https://openwaggle.dev/schemas/agent-definition-v1.schema.json
name: security-reviewer
description: Reviews authorization boundaries
tools: [read_file]
---

Review authorization boundaries and report concrete findings.
`

describe('Agent definitions CLI', () => {
  let root = ''
  let project = ''
  let home = ''
  let stdout: string[] = []
  let stderr: string[] = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agents-cli-'))
    project = path.join(root, 'project')
    home = path.join(root, 'home')
    await Promise.all([fs.mkdir(project, { recursive: true }), fs.mkdir(home, { recursive: true })])
    stdout = []
    stderr = []
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  function run(args: readonly string[]) {
    return runAgentsCli(args, {
      cwd: project,
      home,
      stdout: (value) => {
        stdout.push(value)
      },
      stderr: (value) => stderr.push(value),
      loadSemanticCatalog: async () => ({
        models: ['openai/gpt-5.6'],
        tools: ['read_file'],
        skills: ['code-review'],
        mcpServers: ['github'],
      }),
    })
  }

  function parsedError() {
    return JSON.parse(stderr.join(''))
  }

  it('validates before importing and resolves the imported definition by stable name', async () => {
    const sourcePath = path.join(root, 'incoming.md')
    await fs.writeFile(sourcePath, definition, 'utf8')

    await expect(run(['validate', sourcePath, '--json'])).resolves.toBe(0)
    await expect(run(['import', sourcePath, '--scope', 'project', '--json'])).resolves.toBe(0)
    await expect(run(['explain', 'security-reviewer', '--json'])).resolves.toBe(0)

    expect(
      parseAgentDefinition(
        await fs.readFile(path.join(project, '.openwaggle/agents/security-reviewer.md'), 'utf8'),
      ),
    ).toMatchObject({
      name: 'security-reviewer',
      tools: ['read_file'],
      import: { sourceTool: 'openwaggle', importerVersion: 1 },
    })
    expect(stdout.join('')).toContain('security-reviewer')
    expect(stderr).toEqual([])
  })

  it('refuses an invalid import and does not create a destination file', async () => {
    const sourcePath = path.join(root, 'invalid.md')
    await fs.writeFile(sourcePath, '# missing frontmatter', 'utf8')

    await expect(
      run(['import', sourcePath, '--from', 'openwaggle', '--scope', 'project']),
    ).resolves.toBe(1)
    await expect(fs.readdir(path.join(project, '.openwaggle/agents'))).rejects.toThrow()
    expect(stderr.join('')).toContain('frontmatter')
  })

  it('emits a schema-versioned JSON error when an import fails', async () => {
    const sourcePath = path.join(root, 'invalid.md')
    await fs.writeFile(sourcePath, '# missing frontmatter', 'utf8')

    await expect(
      run(['import', sourcePath, '--from', 'openwaggle', '--scope', 'project', '--json']),
    ).resolves.toBe(1)

    expect(parsedError()).toEqual({
      schemaVersion: 1,
      error: { message: 'Agent definition requires terminated YAML frontmatter.' },
    })
  })

  it('emits a schema-versioned JSON error when explain cannot resolve a definition', async () => {
    await expect(run(['explain', 'missing-role', '--json'])).resolves.toBe(1)

    expect(parsedError()).toEqual({
      schemaVersion: 1,
      error: { message: 'Agent definition "missing-role" was not found.' },
    })
  })

  it('reports unresolved project references and blocks import before writing', async () => {
    const sourcePath = path.join(root, 'unresolved.md')
    await fs.writeFile(
      sourcePath,
      definition.replace('tools: [read_file]', 'tools: [missing_tool]'),
      'utf8',
    )

    await expect(run(['validate', sourcePath, '--json'])).resolves.toBe(1)
    await expect(run(['import', sourcePath, '--scope', 'project', '--json'])).resolves.toBe(1)

    expect(stdout.join('')).toContain('unknown-reference')
    expect(stderr.join('')).toContain('Unknown tool reference')
    await expect(fs.readdir(path.join(project, '.openwaggle/agents'))).rejects.toThrow()
  })

  it('explains semantic diagnostics for a definition authored outside management', async () => {
    const definitionsPath = path.join(project, '.openwaggle', 'agents')
    await fs.mkdir(definitionsPath, { recursive: true })
    await fs.writeFile(
      path.join(definitionsPath, 'security-reviewer.md'),
      definition.replace('tools: [read_file]', 'tools: [missing_tool]'),
      'utf8',
    )

    await expect(run(['explain', 'security-reviewer', '--json'])).resolves.toBe(1)

    expect(stdout.join('')).toContain('semanticValidation')
    expect(stdout.join('')).toContain('Unknown tool reference')
    expect(stderr).toEqual([])
  })

  it('rejects a misspelled dry-run option before creating a destination file', async () => {
    const sourcePath = path.join(root, 'incoming.md')
    await fs.writeFile(sourcePath, definition, 'utf8')

    await expect(run(['import', sourcePath, '--scope', 'project', '--dryrun'])).resolves.toBe(2)
    await expect(fs.readdir(path.join(project, '.openwaggle/agents'))).rejects.toThrow()
    expect(stderr.join('')).toContain('Unknown option for OpenWaggle Agents: --dryrun')
  })

  it('keeps usage failures machine-readable when --json is selected', async () => {
    await expect(run(['validate', '--json'])).resolves.toBe(2)

    expect(parsedError()).toEqual({
      schemaVersion: 1,
      error: { message: 'OpenWaggle Agents validate requires more positional arguments.' },
    })
  })

  it('keeps validation read failures machine-readable when --json is selected', async () => {
    await expect(run(['validate', 'missing.md', '--json'])).resolves.toBe(1)

    expect(parsedError()).toMatchObject({
      schemaVersion: 1,
      error: { message: expect.stringContaining('missing.md') },
    })
  })

  it('rejects option-only invocations instead of reporting successful help', async () => {
    await expect(run(['--dryrun'])).resolves.toBe(2)

    expect(stdout).toEqual([])
    expect(stderr.join('')).toContain(
      'Unsupported option-only invocation for OpenWaggle Agents: --dryrun',
    )
  })

  it('does not overwrite an existing definition unless replacement is explicit', async () => {
    const sourcePath = path.join(root, 'incoming.md')
    await fs.writeFile(sourcePath, definition, 'utf8')
    const firstImport = await run(['import', sourcePath, '--scope', 'user'])
    expect(firstImport, stderr.join('')).toBe(0)
    await expect(run(['import', sourcePath, '--scope', 'user'])).resolves.toBe(1)
    await expect(run(['import', sourcePath, '--scope', 'user', '--replace'])).resolves.toBe(0)
  })

  it('waits for asynchronous stdout before completing', async () => {
    let release: (() => void) | undefined
    let settled = false
    const outputReady = new Promise<void>((resolve) => {
      release = resolve
    })
    const running = runAgentsCli(['list', '--json'], {
      cwd: project,
      home,
      stdout: async () => outputReady,
      stderr: (value) => stderr.push(value),
    }).then((exitCode) => {
      settled = true
      return exitCode
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)

    release?.()
    await expect(running).resolves.toBe(0)
  })

  it('converts asynchronous stdout failures into the controlled CLI failure path', async () => {
    await expect(
      runAgentsCli(['list', '--json'], {
        cwd: project,
        home,
        stdout: async () => Promise.reject(new Error('stdout closed')),
        stderr: (value) => stderr.push(value),
      }),
    ).resolves.toBe(1)
    expect(stderr.join('')).toContain('stdout closed')
  })
})
