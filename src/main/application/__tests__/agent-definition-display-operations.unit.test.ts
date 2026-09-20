import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../../ports/session-projection-repository'
import { SettingsService, type SettingsServiceShape } from '../../services/settings-service'
import {
  getAgentDefinitionPreviewOperation,
  listAgentDefinitionDisplayOperation,
  setAgentDefinitionEnabledOperation,
} from '../agent-definition-display-operations'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

async function fixture() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-display-'))
  temporaryRoots.push(projectPath)
  const directory = path.join(projectPath, '.agents', 'agents')
  await fs.mkdir(directory, { recursive: true })
  const markdown =
    '---\nname: test-reviewer\ndescription: Reviews changes\n---\n\nReview changes.\n'
  await fs.writeFile(path.join(directory, 'test-reviewer.md'), markdown)
  return { projectPath, canonicalProjectPath: await fs.realpath(projectPath), markdown }
}

function layer(projectPath: string, canonicalProjectPath: string, setEnabled = vi.fn()) {
  return Layer.mergeAll(
    Layer.succeed(
      SettingsService,
      fromPartial<SettingsServiceShape>({
        get: () =>
          Effect.succeed({
            ...DEFAULT_SETTINGS,
            projectPath,
            agentDefinitionTogglesByProject: {
              [canonicalProjectPath]: { 'test-reviewer': false },
            },
          }),
        setAgentDefinitionEnabled: (project: string, name: string, enabled: boolean) =>
          Effect.sync(() => setEnabled(project, name, enabled)),
      }),
    ),
    Layer.succeed(
      SessionProjectionRepository,
      fromPartial<SessionProjectionRepositoryShape>({ list: () => Effect.succeed([]) }),
    ),
  )
}

describe('Agent definition display operations', () => {
  it('lists the disk definition with its project toggle and previews the exact Markdown', async () => {
    const { projectPath, canonicalProjectPath, markdown } = await fixture()
    const services = layer(projectPath, canonicalProjectPath)
    const [items, preview] = await Promise.all([
      Effect.runPromise(Effect.provide(listAgentDefinitionDisplayOperation(projectPath), services)),
      Effect.runPromise(
        Effect.provide(getAgentDefinitionPreviewOperation(projectPath, 'test-reviewer'), services),
      ),
    ])

    expect(items).toEqual([
      expect.objectContaining({ name: 'test-reviewer', scope: 'portable-project', enabled: false }),
    ])
    expect(items[0]).not.toHaveProperty('definition')
    expect(preview).toEqual({ markdown })
  })

  it('uses the durable atomic toggle and rejects unknown project paths', async () => {
    const { projectPath, canonicalProjectPath } = await fixture()
    const setEnabled = vi.fn()
    const services = layer(projectPath, canonicalProjectPath, setEnabled)
    await Effect.runPromise(
      Effect.provide(
        setAgentDefinitionEnabledOperation(projectPath, 'test-reviewer', true),
        services,
      ),
    )
    expect(setEnabled).toHaveBeenCalledWith(canonicalProjectPath, 'test-reviewer', true)
    await expect(
      Effect.runPromise(Effect.provide(listAgentDefinitionDisplayOperation(os.tmpdir()), services)),
    ).rejects.toThrow('OpenWaggle project')
  })
})
