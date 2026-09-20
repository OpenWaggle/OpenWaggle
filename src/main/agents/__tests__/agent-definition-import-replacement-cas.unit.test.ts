import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeAgentDefinitionManagement } from '../agent-definition-management'
import { createAgentDefinitionManagementTestPaths } from './agent-definition-management.test-support'

describe('Agent definition import replacement CAS', () => {
  let root = ''
  let projectPath = ''
  let userHome = ''

  beforeEach(async () => {
    ;({ root, projectPath, userHome } = await createAgentDefinitionManagementTestPaths())
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('requires a destination digest before replacing an imported definition', async () => {
    const sourcePath = path.join(root, 'replacement.md')
    await fs.writeFile(
      sourcePath,
      `---\nschemaVersion: 1\nname: replacement\ndescription: Reviews replacements\n---\nReview safely.\n`,
      'utf8',
    )
    const initialPlan = await executeAgentDefinitionManagement(
      {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        sourceTool: 'openwaggle',
        targetScope: 'project',
      },
      { userHome, now: 310 },
    )
    if (initialPlan.operation !== 'import-plan') throw new Error('Expected an import plan.')
    const imported = await executeAgentDefinitionManagement(
      {
        operation: 'import-apply',
        projectPath,
        sourcePath,
        sourceTool: 'openwaggle',
        targetScope: 'project',
        expectedSourceDigest: initialPlan.plan.sourceDigest,
      },
      { userHome, now: 310 },
    )
    if (imported.operation !== 'import-apply') throw new Error('Expected an import outcome.')
    const installed = await fs.readFile(imported.destinationPath, 'utf8')

    await expect(
      executeAgentDefinitionManagement(
        {
          operation: 'import-apply',
          projectPath,
          sourcePath,
          sourceTool: 'openwaggle',
          targetScope: 'project',
          expectedSourceDigest: initialPlan.plan.sourceDigest,
          replaceExisting: true,
        },
        { userHome, now: 320 },
      ),
    ).rejects.toThrow('requires an expected destination content digest')
    await expect(fs.readFile(imported.destinationPath, 'utf8')).resolves.toBe(installed)
  })
})
