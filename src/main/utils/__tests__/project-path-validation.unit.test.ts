import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateAuthorizedProjectPath } from '../project-path-validation'

describe('validateAuthorizedProjectPath', () => {
  let temporaryRoot = ''
  let projectPath = ''
  let otherPath = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-project-authorization-'))
    projectPath = path.join(temporaryRoot, 'project')
    otherPath = path.join(temporaryRoot, 'other')
    await Promise.all([
      fs.mkdir(projectPath, { recursive: true }),
      fs.mkdir(otherPath, { recursive: true }),
    ])
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('returns the canonical path for an exact authorized root, including symlink aliases', async () => {
    const aliasPath = path.join(temporaryRoot, 'project-alias')
    await fs.symlink(projectPath, aliasPath)

    await expect(
      Effect.runPromise(validateAuthorizedProjectPath(aliasPath, [projectPath])),
    ).resolves.toBe(await fs.realpath(projectPath))
  })

  it('fails closed for existing directories outside the authorized roots', async () => {
    await expect(
      Effect.runPromise(validateAuthorizedProjectPath(otherPath, [projectPath])),
    ).rejects.toThrow('Project path is not authorized')
  })

  it('does not authorize a parent merely because a registered project is inside it', async () => {
    await expect(
      Effect.runPromise(validateAuthorizedProjectPath(temporaryRoot, [projectPath])),
    ).rejects.toThrow('Project path is not authorized')
  })
})
