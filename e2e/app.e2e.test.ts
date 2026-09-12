import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import { seedSingleSession } from './support/session-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

test('boots an older settings profile and migrates its terminal layout without errors', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-legacy-startup-')
  const legacyBindings = {
    'commandPalette.toggle': { key: 'K', mod: true },
    'filePicker.toggle': { key: 'P', mod: true },
    'chat.new': { key: 'N', mod: true },
    'terminal.toggle': { key: 'J', mod: true },
    'sidebar.toggle': { key: 'B', mod: true },
    'diff.toggle': { key: 'G', mod: true },
    'sessionTree.toggle': { key: 'Y', mod: true, shift: true },
    'request.focus': { key: 'A', mod: true, shift: true },
  }
  try {
    const sessionId = await seedSingleSession(app.userDataDir, {
      title: 'Older profile session',
      updatedAt: Date.now(),
      messages: [],
    })
    const database = new DatabaseSync(path.join(app.userDataDir, 'openwaggle.db'))
    try {
      database.prepare(
        'INSERT OR REPLACE INTO settings_store (key, value_json, updated_at) VALUES (?, ?, ?)',
      )
        .run('shortcutBindings', JSON.stringify(legacyBindings), Date.now())
    } finally {
      database.close()
    }
    await app.restart()
    const page = app.mainWindow().page
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    // Seed before store construction, after the preceding page has flushed writes.
    await page.addInitScript((ownerKey) => {
      localStorage.setItem(
        'openwaggle:terminal-layout:v1',
        JSON.stringify({
          version: 1,
          state: {
            panelHeight: 380,
            groups: {
              [ownerKey]: {
                tabs: [{
                  id: 'old-tab',
                  customName: 'build',
                  panes: [{ terminalId: 'old-terminal', cwd: '/tmp' }],
                }],
                activeTabId: 'old-tab',
                panelOpen: false,
              },
            },
          },
        }),
      )
    }, sessionId)
    await page.reload()
    await app.mainWindow().waitUntilReady()
    await expect(page.getByText("Couldn't read your settings")).toHaveCount(0)
    const settings = await page.evaluate(() => window.api.getSettings())
    expect(settings.shortcutBindings['diff.toggle']).toEqual(legacyBindings['diff.toggle'])
    expect(settings.shortcutBindings['terminal.new']).toEqual({ key: 'N', mod: true })
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('openwaggle:terminal-layout:v1')))
      .toContain('"version":2')
    const layout = await page.evaluate(() => localStorage.getItem('openwaggle:terminal-layout:v1'))
    expect(layout).toContain('"panelHeight":380')
    expect(layout).toContain('"customName":"build"')

    expect(errors).toEqual([])
    expect(await page.evaluate(() => typeof window.api)).toBe('object')
  } finally {
    await app.cleanup()
  }
})

test('app launches and persists a created thread', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-')

  try {
    if (app.hidden) {
      await expect(app.desktopState()).resolves.toEqual({
        active: false,
        focused: false,
        visible: false,
      })
      await expect(app.desktopPolicyProbe()).resolves.toEqual({
        baseConstructedVisible: false,
        baseFocusBlocked: true,
        baseShowBlocked: true,
        constructedVisible: false,
        focusBlocked: true,
        showBlocked: true,
      })
    }
    const mainWindow = app.mainWindow()
    await expect(mainWindow.page.getByText('No projects yet')).toBeVisible()

    // Seed a session directly — lazy thread creation means the UI
    // button alone doesn't persist a DB row until the first message is sent.
    await seedSingleSession(app.userDataDir, {
      title: 'Persisted Thread',
      updatedAt: Date.now(),
      messages: [],
    })
    await app.restart()

    await expect(app.mainWindow().page.getByText('Persisted Thread')).toBeVisible()
  } finally {
    await app.cleanup()
  }
})

test('welcome keeps the centered project guidance and removes starter cards', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-')

  try {
    const mainWindow = app.mainWindow()
    const welcome = mainWindow.page.getByRole('region', { name: 'Welcome' })
    await expect(welcome).toBeVisible()
    await expect(welcome.getByRole('img', { name: 'OpenWaggle logo' })).toBeVisible()
    await mainWindow.expectComposerValue('')
    await expect(mainWindow.page.getByText('Select a project folder to get started')).toBeVisible()
    await expect(mainWindow.page.getByText('No projects yet')).toBeVisible()
    await expect(
      mainWindow.page.getByRole('button', { name: 'Draft a one-page summary of this app' }),
    ).toHaveCount(0)
    await expect(
      mainWindow.page.getByRole('button', { name: 'Build a coding game in this repo' }),
    ).toHaveCount(0)
    await expect(
      mainWindow.page.getByRole('button', { name: 'Create a refactor plan for this codebase' }),
    ).toHaveCount(0)
  } finally {
    await app.cleanup()
  }
})
