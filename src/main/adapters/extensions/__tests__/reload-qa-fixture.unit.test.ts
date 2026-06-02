import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverExtensionPackages } from '../discovery'

const RELOAD_QA_EXTENSION_ID = 'openwaggle-reload-qa'

let tmpRoot = ''

async function copyReloadQaFixture(projectPath: string) {
  const fixtureSourcePath = path.join(
    process.cwd(),
    'fixtures',
    'extensions',
    RELOAD_QA_EXTENSION_ID,
  )
  const fixtureTargetPath = path.join(
    projectPath,
    ...OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS,
    RELOAD_QA_EXTENSION_ID,
  )
  await fs.mkdir(path.dirname(fixtureTargetPath), { recursive: true })
  await fs.cp(fixtureSourcePath, fixtureTargetPath, { recursive: true })
}

describe('reload QA extension fixture', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-reload-qa-fixture-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('discovers without diagnostics', async () => {
    const projectPath = path.join(tmpRoot, 'project')
    await copyReloadQaFixture(projectPath)

    const packages = await discoverExtensionPackages({
      projectPath,
      hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    })

    expect(packages).toHaveLength(1)
    expect(packages[0]?.id).toBe(RELOAD_QA_EXTENSION_ID)
    expect(packages[0]?.manifest?.name).toBe('OpenWaggle Reload QA')
    expect(packages[0]?.contentHash).toHaveLength(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH)
    expect(packages[0]?.diagnostics).toEqual([])
  })
})
