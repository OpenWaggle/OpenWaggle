import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeAgentDefinitionManagement } from '../agent-definition-management'
import { createAgentDefinitionManagementTestPaths } from './agent-definition-management.test-support'

describe('Agent definition management symlink confinement', () => {
  let root = ''
  let projectPath = ''
  let userHome = ''

  beforeEach(async () => {
    ;({ root, projectPath, userHome } = await createAgentDefinitionManagementTestPaths())
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it.each([
    ['project' as const, '.openwaggle'],
    ['portable-project' as const, '.agents'],
  ])(
    'rejects %s writes and deletes through an escaping definitions symlink',
    async (scope, rootName) => {
      const outsideDefinitions = path.join(root, `outside-${rootName}`)
      const scopedRoot = path.join(projectPath, rootName)
      await Promise.all([
        fs.mkdir(outsideDefinitions, { recursive: true }),
        fs.mkdir(scopedRoot, { recursive: true }),
      ])
      await fs.symlink(outsideDefinitions, path.join(scopedRoot, 'agents'))
      const outsidePath = path.join(outsideDefinitions, 'reviewer.md')
      await fs.writeFile(outsidePath, 'user-owned outside definition', 'utf8')

      await expect(
        executeAgentDefinitionManagement(
          {
            operation: 'write',
            projectPath,
            scope,
            replaceExisting: true,
            document: {
              schemaVersion: 1,
              name: 'reviewer',
              description: 'Reviews changes.',
              instructions: 'Overwrite the outside file.',
            },
          },
          { userHome },
        ),
      ).rejects.toThrow('outside the granted filesystem scope')
      await expect(
        executeAgentDefinitionManagement(
          { operation: 'delete', projectPath, scope, name: 'reviewer' },
          { userHome },
        ),
      ).rejects.toThrow('outside the granted filesystem scope')
      await expect(fs.readFile(outsidePath, 'utf8')).resolves.toBe('user-owned outside definition')
    },
  )
})
