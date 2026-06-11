import { access, cp, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import type { OpenWaggleApi } from '@shared/types/openwaggle-api'

declare global {
  interface Window {
    api: OpenWaggleApi
  }
}

export const GITHUB_ISSUES_EXTENSION_ID = 'openwaggle-github-issues-overview'
export const GITHUB_ISSUES_EXTENSION_NAME = 'GitHub Issues Overview'
export const GITHUB_ISSUES_SETTINGS_TITLE = 'GitHub Issues Settings'

const FIXTURE_ROOT = path.resolve('fixtures', 'extensions')
const PROJECT_EXTENSION_ROOT_SEGMENTS = ['.openwaggle', 'extensions'] as const

function projectExtensionPath(projectPath: string, extensionId: string) {
  return path.join(projectPath, ...PROJECT_EXTENSION_ROOT_SEGMENTS, extensionId)
}

export async function installProjectExtensionFixture(input: {
  readonly projectPath: string
  readonly extensionId: string
}): Promise<string> {
  const sourcePath = path.join(FIXTURE_ROOT, input.extensionId)
  const targetPath = projectExtensionPath(input.projectPath, input.extensionId)

  await rm(targetPath, { recursive: true, force: true })
  await cp(sourcePath, targetPath, { recursive: true })

  return targetPath
}

export async function removeProjectExtensionFixture(input: {
  readonly projectPath: string
  readonly extensionId: string
}): Promise<void> {
  await rm(projectExtensionPath(input.projectPath, input.extensionId), {
    recursive: true,
    force: true,
  })
}

export async function projectExtensionFixtureExists(input: {
  readonly projectPath: string
  readonly extensionId: string
}): Promise<boolean> {
  return access(projectExtensionPath(input.projectPath, input.extensionId))
    .then(() => true)
    .catch(() => false)
}

export async function setActiveProjectForExtensionQa(
  page: Page,
  projectPath: string,
): Promise<void> {
  const result = await page.evaluate(
    (activeProjectPath) =>
      window.api.updateSettings({
        projectPath: activeProjectPath,
        recentProjects: [activeProjectPath],
      }),
    projectPath,
  )

  if (!result.ok) {
    throw new Error(`Failed to set active extension QA project: ${result.error}`)
  }
}
