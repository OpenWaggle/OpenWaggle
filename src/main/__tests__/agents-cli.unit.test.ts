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
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      loadSemanticCatalog: async () => ({
        models: ['openai/gpt-5.6'],
        tools: ['read_file'],
        skills: ['code-review'],
        mcpServers: ['github'],
      }),
    })
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
})
