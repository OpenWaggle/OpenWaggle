import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeAgentDefinitionManagement } from '../agent-definition-management'
import { createAgentDefinitionManagementTestPaths } from './agent-definition-management.test-support'

describe('Agent definition import and refresh integrity', () => {
  let root = ''
  let projectPath = ''
  let userHome = ''

  beforeEach(async () => {
    ;({ root, projectPath, userHome } = await createAgentDefinitionManagementTestPaths())
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('binds Codex source paths and nested content while preserving the selected Agent', async () => {
    const sourcePath = path.join(root, 'config.toml')
    const reviewerPath = path.join(root, 'reviewer.toml')
    const rootContent = `[agents.reviewer]\ndescription = "Reviews"\nconfig_file = "reviewer.toml"\n\n[agents.builder]\ndescription = "Builds"\ndeveloper_instructions = "Build the change."\n`
    const reviewerContent = (version: string) =>
      `developer_instructions = "Review version ${version}."\nmodel = "openai/gpt-5.6"\n`
    await fs.writeFile(sourcePath, rootContent, 'utf8')
    await fs.writeFile(reviewerPath, reviewerContent('one'), 'utf8')

    const initialPlan = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        sourceTool: 'codex',
        sourceName: 'reviewer',
        targetScope: 'project',
      },
      { userHome, now: 410 },
    )
    if (initialPlan.operation !== 'import-plan') throw new Error('Expected an import plan.')
    expect(initialPlan.plan).toMatchObject({
      status: 'ready',
      document: {
        name: 'reviewer',
        import: { sourceName: 'reviewer' },
        instructions: 'Review version one.',
      },
    })

    const mirror = path.join(root, 'mirror')
    await fs.mkdir(mirror)
    await Promise.all([
      fs.writeFile(path.join(mirror, 'config.toml'), rootContent, 'utf8'),
      fs.writeFile(path.join(mirror, 'reviewer.toml'), reviewerContent('one'), 'utf8'),
    ])
    const mirrorPlan = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath: path.join(mirror, 'config.toml'),
        sourceTool: 'codex',
        sourceName: 'reviewer',
        targetScope: 'project',
      },
      { userHome, now: 410 },
    )
    if (mirrorPlan.operation !== 'import-plan') throw new Error('Expected an import plan.')
    expect(mirrorPlan.plan.sourceDigest).not.toBe(initialPlan.plan.sourceDigest)

    await fs.writeFile(reviewerPath, reviewerContent('two'), 'utf8')
    await expect(
      executeAgentDefinitionManagement(
        {
          operation: 'import-apply',
          projectPath,
          sourcePath,
          sourceTool: 'codex',
          sourceName: 'reviewer',
          targetScope: 'project',
          expectedSourceDigest: initialPlan.plan.sourceDigest,
        },
        { userHome, now: 410 },
      ),
    ).rejects.toThrow('Import source changed since the plan was reviewed.')

    const updatedPlan = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        sourceTool: 'codex',
        sourceName: 'reviewer',
        targetScope: 'project',
      },
      { userHome, now: 420 },
    )
    if (updatedPlan.operation !== 'import-plan') throw new Error('Expected an import plan.')
    expect(updatedPlan.plan.sourceDigest).not.toBe(initialPlan.plan.sourceDigest)
    await executeAgentDefinitionManagement(
      {
        operation: 'import-apply',
        projectPath,
        sourcePath,
        sourceTool: 'codex',
        sourceName: 'reviewer',
        targetScope: 'project',
        expectedSourceDigest: updatedPlan.plan.sourceDigest,
      },
      { userHome, now: 420 },
    )

    await fs.writeFile(reviewerPath, reviewerContent('three'), 'utf8')
    const refreshPlan = await executeAgentDefinitionManagement(
      { operation: 'refresh-plan', projectPath, name: 'reviewer' },
      { userHome, now: 430 },
    )
    if (refreshPlan.operation !== 'refresh-plan') throw new Error('Expected a refresh plan.')
    if (!refreshPlan.plan.existingContentDigest) {
      throw new Error('Expected the refresh plan to bind the installed definition.')
    }
    expect(refreshPlan.plan).toMatchObject({
      status: 'ready',
      sourceName: 'reviewer',
      document: {
        import: { sourceName: 'reviewer' },
        instructions: 'Review version three.',
      },
    })

    await fs.writeFile(reviewerPath, reviewerContent('four'), 'utf8')
    await expect(
      executeAgentDefinitionManagement(
        {
          operation: 'refresh-apply',
          projectPath,
          name: 'reviewer',
          expectedSourceDigest: refreshPlan.plan.sourceDigest,
          expectedContentDigest: refreshPlan.plan.existingContentDigest,
        },
        { userHome, now: 440 },
      ),
    ).rejects.toThrow('Import source changed since the refresh plan was reviewed.')
  })

  it('preserves an inferred sole Codex Agent when the source later gains another entry', async () => {
    const sourcePath = path.join(root, 'config.toml')
    const initialSource = `[agents.reviewer]\ndescription = "Reviews"\ndeveloper_instructions = "Review changes."\n`
    await fs.writeFile(sourcePath, initialSource, 'utf8')

    const initialPlan = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        sourceTool: 'codex',
        targetScope: 'project',
      },
      { userHome, now: 440 },
    )
    if (initialPlan.operation !== 'import-plan') throw new Error('Expected an import plan.')
    expect(initialPlan.plan).toMatchObject({
      status: 'ready',
      sourceName: 'reviewer',
      document: { import: { sourceName: 'reviewer' } },
    })
    await executeAgentDefinitionManagement(
      {
        operation: 'import-apply',
        projectPath,
        sourcePath,
        sourceTool: 'codex',
        targetScope: 'project',
        expectedSourceDigest: initialPlan.plan.sourceDigest,
      },
      { userHome, now: 440 },
    )

    await fs.writeFile(
      sourcePath,
      `${initialSource}\n[agents.builder]\ndescription = "Builds"\ndeveloper_instructions = "Build changes."\n`,
      'utf8',
    )
    const refreshPlan = await executeAgentDefinitionManagement(
      { operation: 'refresh-plan', projectPath, name: 'reviewer' },
      { userHome, now: 450 },
    )
    if (refreshPlan.operation !== 'refresh-plan') throw new Error('Expected a refresh plan.')
    expect(refreshPlan.plan).toMatchObject({
      status: 'ready',
      sourceName: 'reviewer',
      document: { name: 'reviewer', instructions: 'Review changes.' },
    })
  })

  it('keeps semantically invalid refreshes blocked when the local definition changed', async () => {
    const sourcePath = path.join(root, 'reviewer.md')
    const sourceDocument = (tool: string) =>
      `---\nschemaVersion: 1\nname: reviewer\ndescription: Reviews changes\ntools: [${tool}]\n---\nReview safely.\n`
    const loadSemanticCatalog = async () => ({
      models: [],
      tools: ['read'],
      skills: [],
      mcpServers: [],
    })
    await fs.writeFile(sourcePath, sourceDocument('read'), 'utf8')

    const importPlan = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        sourceTool: 'openwaggle',
        targetScope: 'project',
      },
      { userHome, now: 450, loadSemanticCatalog },
    )
    if (importPlan.operation !== 'import-plan') throw new Error('Expected an import plan.')
    const imported = await executeAgentDefinitionManagement(
      {
        operation: 'import-apply',
        projectPath,
        sourcePath,
        sourceTool: 'openwaggle',
        targetScope: 'project',
        expectedSourceDigest: importPlan.plan.sourceDigest,
      },
      { userHome, now: 450, loadSemanticCatalog },
    )
    if (imported.operation !== 'import-apply') throw new Error('Expected an import outcome.')
    const installed = await fs.readFile(imported.destinationPath, 'utf8')
    const locallyModified = installed.replace('Review safely.', 'Keep this local instruction.')
    await fs.writeFile(imported.destinationPath, locallyModified, 'utf8')
    await fs.writeFile(sourcePath, sourceDocument('missing_tool'), 'utf8')

    const refreshPlan = await executeAgentDefinitionManagement(
      { operation: 'refresh-plan', projectPath, name: 'reviewer' },
      { userHome, now: 460, loadSemanticCatalog },
    )
    if (refreshPlan.operation !== 'refresh-plan') throw new Error('Expected a refresh plan.')
    if (!refreshPlan.plan.existingContentDigest) {
      throw new Error('Expected the refresh plan to bind the installed definition.')
    }
    expect(refreshPlan.plan).toMatchObject({
      status: 'blocked',
      diagnostics: expect.arrayContaining([
        expect.stringContaining('Unknown tool reference "missing_tool"'),
        'The imported Agent definition was modified locally.',
      ]),
    })

    await expect(
      executeAgentDefinitionManagement(
        {
          operation: 'refresh-apply',
          projectPath,
          name: 'reviewer',
          expectedSourceDigest: refreshPlan.plan.sourceDigest,
          expectedContentDigest: refreshPlan.plan.existingContentDigest,
          replaceModified: true,
        },
        { userHome, now: 460, loadSemanticCatalog },
      ),
    ).rejects.toThrow('Unknown tool reference "missing_tool"')
    await expect(fs.readFile(imported.destinationPath, 'utf8')).resolves.toBe(locallyModified)
  })
})
