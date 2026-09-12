import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { queryAgentDefinitionsForTool } from '../sessions-tool-extension'

describe('Pi-native Sessions tool Agent definitions', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    )
  })

  it('discovers optional Agent definitions without loading instruction bodies into context', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-tool-agents-'))
    temporaryRoots.push(projectPath)
    const directory = path.join(projectPath, '.openwaggle', 'agents')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(
      path.join(directory, 'reviewer.md'),
      `---
schemaVersion: 1
name: reviewer
description: Reviews security boundaries
---

These instructions must only enter a Run after explicit selection.
`,
      'utf8',
    )

    await expect(
      queryAgentDefinitionsForTool(
        { action: 'agent_definitions_search', query: 'security', limit: 10 },
        projectPath,
      ),
    ).resolves.toEqual({
      definitions: [
        {
          name: 'reviewer',
          description: 'Reviews security boundaries',
          scope: 'project',
          valid: true,
        },
      ],
    })
  })
})
