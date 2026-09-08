import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import type { LocalSessionProfileManagementEnvelope } from '../src/shared/types/local-session-profile'
import type { LocalSessionProfileSummary } from '../src/shared/types/local-session-profile-management'
import { OpenWaggleApp } from './support/openwaggle-app'

type ExpectedProfilePolicy = Pick<
  LocalSessionProfileSummary,
  'name' | 'capabilities' | 'scope' | 'authorizationCeiling' | 'managementEnvelope'
>

async function expectStoredPolicy(app: OpenWaggleApp, policy: ExpectedProfilePolicy) {
  const listed = await app.runCli(['access', 'profiles', 'list', '--json'])
  expect(listed.stderr).toBe('')
  const response: unknown = JSON.parse(listed.stdout)
  expect(response).toMatchObject({
    outcome: {
      effect: 'profiles-listed',
      // The nested scope and envelope must match exactly, not merely contain their old grants.
      profiles: [expect.objectContaining(policy)],
    },
  })
}

async function openProfileSettings(page: Page, profileName: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'General', exact: true }).click()
  await page.getByRole('button', { name: /^Restricted CLI profiles/ }).click()
  await expect(page.getByText(profileName, { exact: true })).toBeVisible()
}

function collectErrors(page: Page, errors: string[]) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
}

test('restricted CLI profile UI edits preserve resource roots and narrower management authority', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-restricted-cli-profile-')
  try {
    const page = app.window()
    const errors: string[] = []
    collectErrors(page, errors)
    const projectPath = await realpath(app.userDataDir)
    const exportRoot = path.join(projectPath, 'exports')
    const attachmentRoot = path.join(projectPath, 'attachments')
    const delegatedExportRoot = path.join(exportRoot, 'delegated')
    const delegatedAttachmentRoot = path.join(attachmentRoot, 'delegated')
    await Promise.all([
      mkdir(delegatedExportRoot, { recursive: true }),
      mkdir(delegatedAttachmentRoot, { recursive: true }),
    ])
    const name = 'e2e-narrow-profile-manager'
    const managementEnvelope = {
      capabilities: ['sessions:read'],
      scope: {
        projectPaths: [projectPath],
        exportRoots: [delegatedExportRoot],
        attachmentRoots: [delegatedAttachmentRoot],
      },
      authorizationCeiling: 'ask-for-approval',
    } satisfies LocalSessionProfileManagementEnvelope
    const created = await app.runCli([
      'access',
      'profiles',
      'create',
      name,
      '--capability',
      'sessions:read',
      '--capability',
      'access:profiles',
      '--project',
      projectPath,
      '--export-root',
      exportRoot,
      '--attachment-root',
      attachmentRoot,
      '--authorization',
      'ask-for-approval',
      '--management-envelope-json',
      JSON.stringify(managementEnvelope),
      '--credential-store',
      '--json',
    ])
    expect(created.stderr).toBe('')
    const createdResponse: unknown = JSON.parse(created.stdout)
    expect(createdResponse).toMatchObject({ outcome: { effect: 'profile-created' } })

    await openProfileSettings(page, name)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `Edit ${name}`, exact: true })
    await expect(dialog.getByLabel('Profile name', { exact: true })).toBeDisabled()
    await expect(dialog.getByLabel('Projects, one path per line')).toHaveValue(projectPath)
    await dialog.getByLabel('sessions · start', { exact: true }).check()
    await dialog.getByRole('combobox', { name: /Authorization ceiling/ }).selectOption('yolo')
    await dialog.getByRole('button', { name: 'Save profile', exact: true }).click()
    await expect(dialog).toBeHidden()

    const updatedPolicy = {
      name,
      capabilities: ['sessions:read', 'sessions:start', 'access:profiles'],
      scope: {
        projectPaths: [projectPath],
        exportRoots: [exportRoot],
        attachmentRoots: [attachmentRoot],
      },
      authorizationCeiling: 'yolo',
      managementEnvelope,
    } satisfies ExpectedProfilePolicy
    await expectStoredPolicy(app, updatedPolicy)

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await dialog.getByLabel('All Sessions and projects', { exact: true }).check()
    await dialog.getByRole('button', { name: 'Save profile', exact: true }).click()
    await expect(dialog).toBeHidden()
    const allSessionsPolicy = {
      ...updatedPolicy,
      scope: {
        all: true,
        exportRoots: [exportRoot],
        attachmentRoots: [attachmentRoot],
      },
    } satisfies ExpectedProfilePolicy
    await expectStoredPolicy(app, allSessionsPolicy)

    await app.restart()
    const restartedPage = app.window()
    collectErrors(restartedPage, errors)
    await openProfileSettings(restartedPage, name)
    await restartedPage.getByRole('button', { name: 'Edit', exact: true }).click()
    const persistedDialog = restartedPage.getByRole('dialog', {
      name: `Edit ${name}`,
      exact: true,
    })
    await expect(persistedDialog.getByLabel('All Sessions and projects')).toBeChecked()
    await expect(persistedDialog.getByLabel('sessions · start', { exact: true })).toBeChecked()
    await expect(persistedDialog.getByLabel('access · profiles', { exact: true })).toBeChecked()
    await expect(
      persistedDialog.getByRole('combobox', { name: /Authorization ceiling/ }),
    ).toHaveValue('yolo')
    await expectStoredPolicy(app, allSessionsPolicy)
    expect(errors).toEqual([])
  } finally {
    await app.cleanup()
  }
})
