import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, shell } from 'electron'
import { env } from './env'
import { registerAgentHandlers } from './ipc/agent-handler'
import { registerConversationsHandlers } from './ipc/conversations-handler'
import { registerGitHandlers } from './ipc/git-handler'
import { registerProjectHandlers } from './ipc/project-handler'
import { registerProvidersHandlers } from './ipc/providers-handler'
import { registerSettingsHandlers } from './ipc/settings-handler'
import { cleanupTerminals, registerTerminalHandlers } from './ipc/terminal-handler'
import { registerAllProviders } from './providers'

if (env.OPENHIVE_USER_DATA_DIR) {
  app.setPath('userData', env.OPENHIVE_USER_DATA_DIR)
}

const appIconPath = join(__dirname, '../../build/icon.png')

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#141619',
    icon: appIconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-changed', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-changed', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.openhive.app')
  if (process.platform === 'darwin') {
    app.dock?.setIcon(appIconPath)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register IPC handlers (these don't need the registry to be populated yet,
  // they just reference it at call-time)
  registerAgentHandlers()
  registerSettingsHandlers()
  registerConversationsHandlers()
  registerGitHandlers()
  registerProjectHandlers()
  registerProvidersHandlers()
  registerTerminalHandlers()

  // Register providers (async — individual failures are caught per-provider)
  registerAllProviders().then(() => {
    createWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  cleanupTerminals()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
