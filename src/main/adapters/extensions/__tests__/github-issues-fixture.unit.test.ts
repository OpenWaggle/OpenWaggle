import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import type { ExtensionContributions } from '@shared/schemas/extensions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverExtensionPackages } from '../discovery'

const GITHUB_ISSUES_EXTENSION_ID = 'openwaggle-github-issues-overview'
const FIXTURE_EXTENSION_PATH = path.join(
  process.cwd(),
  'fixtures',
  'extensions',
  GITHUB_ISSUES_EXTENSION_ID,
)
const piPackageManifestSchema = Schema.Struct({
  pi: Schema.Struct({
    extensions: Schema.Array(Schema.String),
  }),
})

let tmpRoot = ''

async function copyGithubIssuesFixture(projectPath: string) {
  const fixtureTargetPath = path.join(
    projectPath,
    ...OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS,
    GITHUB_ISSUES_EXTENSION_ID,
  )
  await fs.mkdir(path.dirname(fixtureTargetPath), { recursive: true })
  await fs.cp(FIXTURE_EXTENSION_PATH, fixtureTargetPath, { recursive: true })
}

function expectGithubFixtureContributions(contributions: ExtensionContributions) {
  expect(contributions.settingsSections).toHaveLength(1)
  expect(contributions.sidePanels).toHaveLength(1)
  expect(contributions.transcriptRenderers).toHaveLength(1)
  expect(contributions.toolRenderers).toHaveLength(1)
  expect(contributions.customMessageRenderers).toHaveLength(1)
  expect(contributions.interactionRenderers).toHaveLength(1)
  expect(contributions.statusWidgets).toHaveLength(1)
}

async function readFixturePackageManifest() {
  const rawPackageJson = await fs.readFile(
    path.join(FIXTURE_EXTENSION_PATH, 'package.json'),
    'utf-8',
  )
  const parsedPackageJson = parseJsonUnknown(rawPackageJson)
  const decodedPackageJson = safeDecodeUnknown(piPackageManifestSchema, parsedPackageJson)
  if (!decodedPackageJson.success) {
    throw new Error('Expected GitHub Issues fixture package.json to declare pi.extensions.')
  }
  return decodedPackageJson.data
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

  it('discovers settings, side panel, and agent-loop contributions without diagnostics', async () => {
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
    const contributions = extensionPackage.manifest?.contributions
    if (!contributions) {
      throw new Error('Expected GitHub Issues Overview fixture contributions.')
    }
    expectGithubFixtureContributions(contributions)
    expect(extensionPackage.manifest.sourceFiles).toContain('package.json')
    expect(extensionPackage.manifest.builtArtifacts).toContain('package.json')
    expect(extensionPackage.manifest?.pi?.resourceRoots).toBeUndefined()
    expect(extensionPackage.contentHash).toHaveLength(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH)
    expect(extensionPackage.diagnostics).toEqual([])
  })

  it('declares Pi extension entries as loadable files', async () => {
    const packageManifest = await readFixturePackageManifest()
    const piExtensions = packageManifest.pi?.extensions ?? []

    expect(piExtensions).toEqual(['pi/extensions/github-issues-tool.js'])
    for (const extensionPath of piExtensions) {
      const stats = await fs.stat(path.join(FIXTURE_EXTENSION_PATH, extensionPath))
      expect(stats.isFile()).toBe(true)
    }
  })
})
