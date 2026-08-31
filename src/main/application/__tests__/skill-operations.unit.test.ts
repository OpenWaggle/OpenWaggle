import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsService } from '../../services/settings-service'
import {
  getSkillPreviewOperation,
  listSkillsOperation,
  setSkillEnabledOperation,
} from '../skill-operations'

const tempDirs: string[] = []

async function makeProjectWithSkill() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-skill-operations-'))
  tempDirs.push(projectPath)
  const skillDirectory = path.join(projectPath, '.openwaggle', 'skills', 'code-review')
  await fs.mkdir(skillDirectory, { recursive: true })
  await fs.writeFile(
    path.join(skillDirectory, 'SKILL.md'),
    `---
name: code-review
description: Review code changes.
---

# Review instructions`,
    'utf8',
  )
  return projectPath
}

function settingsLayer(input?: {
  readonly settings?: Settings
  readonly update?: (partial: Partial<Settings>) => void
}) {
  return Layer.succeed(SettingsService, {
    get: () => Effect.succeed(input?.settings ?? DEFAULT_SETTINGS),
    update: (partial) => Effect.sync(() => input?.update?.(partial)),
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  })
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('skill operations', () => {
  it('lists and previews skills using persisted project toggles', async () => {
    const projectPath = await makeProjectWithSkill()
    const layer = settingsLayer({
      settings: {
        ...DEFAULT_SETTINGS,
        skillTogglesByProject: { [projectPath]: { 'code-review': false } },
      },
    })

    const catalog = await Effect.runPromise(Effect.provide(listSkillsOperation(projectPath), layer))
    const preview = await Effect.runPromise(
      Effect.provide(getSkillPreviewOperation(projectPath, 'code-review'), layer),
    )

    expect(catalog.skills).toEqual([
      expect.objectContaining({ id: 'code-review', enabled: false, loadStatus: 'ok' }),
    ])
    expect(preview).toEqual({ markdown: '# Review instructions' })
  })

  it('merges one skill toggle without losing other projects or skills', async () => {
    const update = vi.fn()
    const layer = settingsLayer({
      settings: {
        ...DEFAULT_SETTINGS,
        skillTogglesByProject: {
          '/project': { existing: true },
          '/other': { retained: false },
        },
      },
      update,
    })

    await Effect.runPromise(
      Effect.provide(setSkillEnabledOperation('/project', 'code-review', false), layer),
    )

    expect(update).toHaveBeenCalledWith({
      skillTogglesByProject: {
        '/project': { existing: true, 'code-review': false },
        '/other': { retained: false },
      },
    })
  })

  it('rejects empty project paths and skill ids before reading settings', async () => {
    const layer = settingsLayer()
    await expect(
      Effect.runPromise(Effect.provide(listSkillsOperation(''), layer)),
    ).rejects.toThrow()
    await expect(
      Effect.runPromise(Effect.provide(getSkillPreviewOperation('/project', ''), layer)),
    ).rejects.toThrow()
  })
})
