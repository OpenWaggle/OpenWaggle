import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverExtensionPackages } from '../discovery'

const GITHUB_ISSUES_EXTENSION_ID = 'openwaggle-github-issues-overview'

let tmpRoot = ''

async function copyGithubIssuesFixture(projectPath: string) {
  const fixtureSourcePath = path.join(
    process.cwd(),
    'fixtures',
    'extensions',
    GITHUB_ISSUES_EXTENSION_ID,
  )
  const fixtureTargetPath = path.join(
    projectPath,
    ...OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS,
    GITHUB_ISSUES_EXTENSION_ID,
  )
  await fs.mkdir(path.dirname(fixtureTargetPath), { recursive: true })
  await fs.cp(fixtureSourcePath, fixtureTargetPath, { recursive: true })
}

describe('GitHub Issues Overview extension fixture', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-github-issues-fixture-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('discovers settings and side panel contributions without diagnostics', async () => {
    const projectPath = path.join(tmpRoot, 'project')
    await copyGithubIssuesFixture(projectPath)

    const packages = await discoverExtensionPackages({
      projectPath,
      hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    })
    const extensionPackage = packages.at(0)
    if (!extensionPackage) {
      throw new Error('Expected GitHub Issues Overview fixture package.')
    }

    expect(packages).toHaveLength(1)
    expect(extensionPackage.id).toBe(GITHUB_ISSUES_EXTENSION_ID)
    expect(extensionPackage.manifest?.name).toBe('GitHub Issues Overview')
    expect(extensionPackage.manifest?.contributions?.settingsSections).toHaveLength(1)
    expect(extensionPackage.manifest?.contributions?.sidePanels).toHaveLength(1)
    expect(extensionPackage.contentHash).toHaveLength(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH)
    expect(extensionPackage.diagnostics).toEqual([])
  })
})
