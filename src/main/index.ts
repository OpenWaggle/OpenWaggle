import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, shell } from 'electron'
import { startDevtoolsEventBus, stopDevtoolsEventBus } from './devtools/event-bus'
import { env } from './env'
import { registerAgentHandlers } from './ipc/agent-handler'
import { registerAttachmentHandlers } from './ipc/attachments-handler'
import { registerAuthHandlers } from './ipc/auth-handler'
import { registerConversationsHandlers } from './ipc/conversations-handler'
import { registerDevtoolsHandlers } from './ipc/devtools-handler'
import { registerGitHandlers } from './ipc/git'
import { registerMcpHandlers } from './ipc/mcp-handler'
import { registerOrchestrationHandlers } from './ipc/orchestration-handler'
import { registerProjectHandlers } from './ipc/project-handler'
import { registerProvidersHandlers } from './ipc/providers-handler'
import { registerSettingsHandlers } from './ipc/settings-handler'
import { registerShellHandlers } from './ipc/shell-handler'
import { registerSkillsHandlers } from './ipc/skills-handler'
import { registerTeamsHandlers } from './ipc/teams-handler'
import { cleanupTerminals, registerTerminalHandlers } from './ipc/terminal-handler'
import { registerVoiceHandlers } from './ipc/voice-handler'
import { registerWaggleHandlers } from './ipc/waggle-handler'
import { initFileLogger } from './logger'
import { mcpManager } from './mcp'
import { registerAllProviders } from './providers'
import { getSettings } from './store/settings'

if (env.OPENWAGGLE_USER_DATA_DIR) {
  app.setPath('userData', env.OPENWAGGLE_USER_DATA_DIR)
}

const appIconPath = join(__dirname, '../../build/icon.png')

function isTrustedRendererRequest(url: string): boolean {
  if (url.startsWith('file://')) return true
  if (!env.ELECTRON_RENDERER_URL) return false

  try {
    return new URL(url).origin === new URL(env.ELECTRON_RENDERER_URL).origin
  } catch {
    return false
  }
}

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
      sandbox: true,
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

  // Prevent in-app navigation — all external URLs open in the user's default browser
  const rendererOrigin = is.dev && env.ELECTRON_RENDERER_URL ? env.ELECTRON_RENDERER_URL : 'file://'
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(rendererOrigin)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  const mediaPermissions = new Set(['media', 'microphone'])
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) => {
      if (!mediaPermissions.has(permission)) return false
      return isTrustedRendererRequest(requestingOrigin)
    },
  )
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (!mediaPermissions.has(permission)) {
        callback(false)
        return
      }
      callback(isTrustedRendererRequest(details.requestingUrl))
    },
  )

  if (is.dev && env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.openwaggle.app')
  if (process.platform === 'darwin') {
    app.dock?.setIcon(appIconPath)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register IPC handlers (these don't need the registry to be populated yet,
  // they just reference it at call-time)
  registerAuthHandlers()
  registerAgentHandlers()
  registerSettingsHandlers()
  registerConversationsHandlers()
  registerAttachmentHandlers()
  registerDevtoolsHandlers()
  registerGitHandlers()
  registerProjectHandlers()
  registerProvidersHandlers()
  registerOrchestrationHandlers()
  registerTerminalHandlers()
  registerVoiceHandlers()
  registerSkillsHandlers()
  registerShellHandlers()
  registerWaggleHandlers()
  registerTeamsHandlers()
  registerMcpHandlers()

  // Initialize file logger now that app paths are available
  initFileLogger(app.getPath('logs'))

  // Register providers (async — individual failures are caught per-provider)
  Promise.all([registerAllProviders(), startDevtoolsEventBus()]).then(async () => {
    // Initialize MCP servers from persisted config
    const settings = getSettings()
    await mcpManager.initialize(settings.mcpServers)
    createWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let mcpCleanupDone = false

app.on('window-all-closed', () => {
  cleanupTerminals()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (e) => {
  stopDevtoolsEventBus()
  if (!mcpCleanupDone) {
    e.preventDefault()
    mcpManager.disconnectAll().finally(() => {
      mcpCleanupDone = true
      app.quit()
    })
  }
})
