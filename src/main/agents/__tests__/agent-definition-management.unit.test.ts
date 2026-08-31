import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeAgentDefinitionManagement } from '../agent-definition-management'
import { createAgentDefinitionManagementTestPaths } from './agent-definition-management.test-support'

describe('Agent definition management and imports', () => {
  let root = ''
  let projectPath = ''
  let userHome = ''

  beforeEach(async () => {
    ;({ root, projectPath, userHome } = await createAgentDefinitionManagementTestPaths())
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('writes, duplicates, lists every scope, and deletes with optimistic digests', async () => {
    const written = await executeAgentDefinitionManagement(
      {
        operation: 'write',
        projectPath,
        scope: 'project',
        document: {
          schemaVersion: 1,
          name: 'reviewer',
          description: 'Reviews changes.',
          instructions: 'Review the change and report findings.',
        },
      },
      { userHome, now: 100 },
    )
    await executeAgentDefinitionManagement(
      {
        operation: 'duplicate',
        projectPath,
        sourceName: 'reviewer',
        targetName: 'reviewer-copy',
        targetScope: 'user',
      },
      { userHome, now: 110 },
    )
    const listed = await executeAgentDefinitionManagement(
      { operation: 'list', projectPath },
      { userHome },
    )
    expect(listed).toMatchObject({
      operation: 'list',
      items: expect.arrayContaining([
        expect.objectContaining({
          name: 'reviewer',
          scope: 'project',
          contentDigest: expect.any(String),
        }),
        expect.objectContaining({ name: 'reviewer-copy', scope: 'user' }),
      ]),
    })
    if (written.operation !== 'write') throw new Error('Expected a write outcome.')
    await expect(
      executeAgentDefinitionManagement(
        {
          operation: 'delete',
          projectPath,
          scope: 'project',
          name: 'reviewer',
          expectedContentDigest: written.contentDigest,
        },
        { userHome },
      ),
    ).resolves.toMatchObject({ operation: 'delete', name: 'reviewer' })
  })

  it('plans a restrictive foreign import, installs provenance, and detects refresh conflicts', async () => {
    const sourcePath = path.join(root, '.claude', 'agents', 'security-reviewer.md')
    await fs.mkdir(path.dirname(sourcePath), { recursive: true })
    await fs.writeFile(
      sourcePath,
      `---\nname: security-reviewer\ndescription: Reviews security\nmodel: sonnet\ntools: [Read, Grep, Bash]\n---\n\nReview authorization boundaries.\n`,
      'utf8',
    )
    const planned = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        sourceTool: 'claude-code',
        targetScope: 'project',
      },
      { userHome, now: 200 },
    )
    if (planned.operation !== 'import-plan') throw new Error('Expected an import plan.')
    expect(planned.plan).toMatchObject({
      status: 'ready',
      document: {
        name: 'security-reviewer',
        import: { sourceTool: 'claude-code', importerVersion: 1 },
      },
      fields: expect.arrayContaining([
        expect.objectContaining({ sourceField: 'tools', disposition: 'dropped' }),
        expect.objectContaining({ sourceField: 'model', disposition: 'dropped' }),
      ]),
    })
    const applied = await executeAgentDefinitionManagement(
      {
        operation: 'import-apply',
        projectPath,
        sourcePath,
        sourceTool: 'claude-code',
        targetScope: 'project',
        expectedSourceDigest: planned.plan.sourceDigest,
      },
      { userHome, now: 200 },
    )
    if (applied.operation !== 'import-apply') throw new Error('Expected an import outcome.')
    const markdown = await fs.readFile(applied.destinationPath, 'utf8')
    await fs.writeFile(
      applied.destinationPath,
      markdown.replace('Review authorization boundaries.', 'Review locally customized boundaries.'),
      'utf8',
    )
    const refresh = await executeAgentDefinitionManagement(
      { operation: 'refresh-plan', projectPath, name: 'security-reviewer' },
      { userHome, now: 300 },
    )
    expect(refresh).toMatchObject({
      operation: 'refresh-plan',
      plan: {
        status: 'conflict',
        diagnostics: expect.arrayContaining([
          'The imported Agent definition was modified locally.',
        ]),
      },
    })
  })

  it('requires selecting one named Agent from a multi-Agent Codex config', async () => {
    const sourcePath = path.join(root, 'config.toml')
    await fs.writeFile(
      sourcePath,
      `[agents.reviewer]\ndescription = "Reviews"\nconfig_file = "reviewer.toml"\n\n[agents.builder]\ndescription = "Builds"\nconfig_file = "builder.toml"\n`,
      'utf8',
    )
    const outcome = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        sourceTool: 'codex',
        targetScope: 'project',
      },
      { userHome, now: 400 },
    )
    expect(outcome).toMatchObject({
      operation: 'import-plan',
      plan: { status: 'blocked', diagnostics: [expect.stringContaining('--source-name')] },
    })
  })

  it('blocks an import whose project references do not resolve', async () => {
    const sourcePath = path.join(root, 'unresolved.md')
    await fs.writeFile(
      sourcePath,
      `---\nschemaVersion: 1\nname: unresolved\ndescription: Uses a missing tool\ntools: [missing_tool]\n---\nReview changes.\n`,
      'utf8',
    )
    const loadSemanticCatalog = async () => ({
      models: ['openai/gpt-5.6'],
      tools: ['read'],
      skills: ['code-review'],
      mcpServers: ['github'],
    })

    const outcome = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        sourceTool: 'openwaggle',
        targetScope: 'project',
      },
      { userHome, now: 425, loadSemanticCatalog },
    )

    expect(outcome).toMatchObject({
      operation: 'import-plan',
      plan: {
        status: 'blocked',
        diagnostics: [expect.stringContaining('Unknown tool reference "missing_tool"')],
      },
    })
    await expect(
      executeAgentDefinitionManagement(
        {
          operation: 'import-apply',
          projectPath,
          sourcePath,
          sourceTool: 'openwaggle',
          targetScope: 'project',
          expectedSourceDigest:
            outcome.operation === 'import-plan' ? outcome.plan.sourceDigest : 'unreachable',
        },
        { userHome, now: 425, loadSemanticCatalog },
      ),
    ).rejects.toThrow('Unknown tool reference')
    await expect(fs.readdir(path.join(projectPath, '.openwaggle/agents'))).rejects.toThrow()
  })

  it('blocks an import plan when its destination cannot be safely inspected', async () => {
    if (process.platform === 'win32') return
    const sourcePath = path.join(root, 'source.agent.md')
    const definitions = path.join(projectPath, '.openwaggle', 'agents')
    const outside = path.join(root, 'outside.md')
    await fs.writeFile(
      sourcePath,
      `---\nname: reviewer\ndescription: Reviews changes\n---\nReview safely.\n`,
      'utf8',
    )
    await fs.mkdir(definitions, { recursive: true })
    await fs.writeFile(outside, 'outside content', 'utf8')
    await fs.symlink(outside, path.join(definitions, 'reviewer.md'))

    const outcome = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        sourceTool: 'github-copilot',
        targetScope: 'project',
      },
      { userHome, now: 450 },
    )

    expect(outcome).toMatchObject({
      operation: 'import-plan',
      plan: {
        status: 'blocked',
        diagnostics: [expect.stringContaining('cannot be safely inspected')],
      },
    })
  })

  it('serializes concurrent writes to the same Agent definition', async () => {
    const writes = await Promise.allSettled(
      ['First writer.', 'Second writer.'].map((instructions) =>
        executeAgentDefinitionManagement(
          {
            operation: 'write',
            projectPath,
            scope: 'project',
            document: {
              schemaVersion: 1,
              name: 'concurrent-reviewer',
              description: 'Reviews concurrent changes.',
              instructions,
            },
          },
          { userHome, now: 500 },
        ),
      ),
    )
    const successes = writes.filter((result) => result.status === 'fulfilled')
    const failures = writes.filter((result) => result.status === 'rejected')
    const stored = await fs.readFile(
      path.join(projectPath, '.openwaggle', 'agents', 'concurrent-reviewer.md'),
      'utf8',
    )

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(
      ['First writer.', 'Second writer.'].filter((instructions) => stored.includes(instructions)),
    ).toHaveLength(1)
  })
})
