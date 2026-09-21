import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeAgentDefinitionManagement } from '../agent-definition-management'
import { createAgentDefinitionManagementTestPaths } from './agent-definition-management.test-support'

describe('Agent definition refresh compare-and-swap', () => {
  let root = ''
  let projectPath = ''
  let userHome = ''

  beforeEach(async () => {
    ;({ root, projectPath, userHome } = await createAgentDefinitionManagementTestPaths())
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('rejects a refresh when the reviewed destination changes before apply', async () => {
    const sourcePath = path.join(root, 'reviewer.source.md')
    const sourceDocument = (instructions: string) =>
      `---\nschemaVersion: 1\nname: reviewer\ndescription: Reviews changes\n---\n${instructions}\n`
    await fs.writeFile(sourcePath, sourceDocument('Review source version one.'), 'utf8')

    const importPlan = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        sourceTool: 'openwaggle',
        targetScope: 'project',
      },
      { userHome, now: 310 },
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
      { userHome, now: 310 },
    )
    if (imported.operation !== 'import-apply') throw new Error('Expected an import outcome.')

    const installed = await fs.readFile(imported.destinationPath, 'utf8')
    const reviewedLocalEdit = installed.replace(
      'Review source version one.',
      'Keep reviewed local edit.',
    )
    await fs.writeFile(imported.destinationPath, reviewedLocalEdit, 'utf8')
    await fs.writeFile(sourcePath, sourceDocument('Review source version two.'), 'utf8')
    const refreshPlan = await executeAgentDefinitionManagement(
      { operation: 'refresh-plan', projectPath, name: 'reviewer' },
      { userHome, now: 320 },
    )
    if (refreshPlan.operation !== 'refresh-plan') throw new Error('Expected a refresh plan.')
    if (!refreshPlan.plan.existingContentDigest) {
      throw new Error('Expected the refresh plan to bind the installed definition.')
    }
    expect(refreshPlan.plan.status).toBe('conflict')

    const concurrentLocalEdit = reviewedLocalEdit.replace(
      'Keep reviewed local edit.',
      'Preserve concurrent local edit.',
    )
    await fs.writeFile(imported.destinationPath, concurrentLocalEdit, 'utf8')

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
        { userHome, now: 330 },
      ),
    ).rejects.toThrow('Agent definition changed since the refresh plan was reviewed.')
    await expect(fs.readFile(imported.destinationPath, 'utf8')).resolves.toBe(concurrentLocalEdit)
  })
})
