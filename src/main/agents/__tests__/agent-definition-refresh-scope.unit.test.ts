import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentDefinitionScope } from '@shared/types/agent-definition'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listAllAgentDefinitions, resolveAgentDefinition } from '../agent-definition-catalog'
import { executeAgentDefinitionManagement } from '../agent-definition-management'
import { createAgentDefinitionManagementTestPaths } from './agent-definition-management.test-support'

describe('Agent definition refresh scope', () => {
  let root = ''
  let projectPath = ''
  let userHome = ''

  beforeEach(async () => {
    ;({ root, projectPath, userHome } = await createAgentDefinitionManagementTestPaths())
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  async function importReviewer(scope: AgentDefinitionScope, instructions: string) {
    const sourcePath = path.join(root, `${scope}-source.md`)
    await fs.writeFile(
      sourcePath,
      `---\nschemaVersion: 1\nname: reviewer\ndescription: Reviews changes\n---\n${instructions}\n`,
      'utf8',
    )
    const planned = await executeAgentDefinitionManagement(
      { operation: 'import-plan', projectPath, sourcePath, targetScope: scope },
      { userHome },
    )
    if (planned.operation !== 'import-plan') throw new Error('Expected import plan.')
    await executeAgentDefinitionManagement(
      {
        operation: 'import-apply',
        projectPath,
        sourcePath,
        targetScope: scope,
        expectedSourceDigest: planned.plan.sourceDigest,
      },
      { userHome },
    )
    return sourcePath
  }

  it('plans and applies refresh to the selected lower-precedence definition', async () => {
    await importReviewer('project', 'Project version.')
    const userSource = await importReviewer('user', 'User version one.')
    await fs.writeFile(
      userSource,
      '---\nschemaVersion: 1\nname: reviewer\ndescription: Reviews changes\n---\nUser version two.\n',
      'utf8',
    )

    const defaultDefinition = await resolveAgentDefinition({
      projectPath,
      userHome,
      name: 'reviewer',
    })
    expect(defaultDefinition.scope).toBe('project')
    const selectedDefinition = await resolveAgentDefinition({
      projectPath,
      userHome,
      name: 'reviewer',
      scope: 'user',
    })
    expect(selectedDefinition.import?.sourcePath).toBe(await fs.realpath(userSource))

    const planned = await executeAgentDefinitionManagement(
      { operation: 'refresh-plan', projectPath, name: 'reviewer', scope: 'user' },
      { userHome },
    )
    if (planned.operation !== 'refresh-plan' || !planned.plan.existingContentDigest) {
      throw new Error('Expected scoped refresh plan.')
    }
    expect(planned.plan).toMatchObject({
      targetScope: 'user',
      document: { instructions: 'User version two.' },
    })
    const applied = await executeAgentDefinitionManagement(
      {
        operation: 'refresh-apply',
        projectPath,
        name: 'reviewer',
        scope: 'user',
        expectedSourceDigest: planned.plan.sourceDigest,
        expectedContentDigest: planned.plan.existingContentDigest,
      },
      { userHome },
    )
    expect(applied).toMatchObject({ operation: 'refresh-apply', scope: 'user' })
    const items = await listAllAgentDefinitions({ projectPath, userHome })
    expect(items.find((item) => item.scope === 'project')?.definition?.instructions).toBe(
      'Project version.',
    )
    expect(items.find((item) => item.scope === 'user')?.definition?.instructions).toBe(
      'User version two.',
    )
  })
})
