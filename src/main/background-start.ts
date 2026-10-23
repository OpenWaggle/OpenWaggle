import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { APP_ID, PRODUCT_NAME } from '@shared/build-identity-runtime'
import type { BackgroundStartStatus } from '@shared/types/ipc-invoke-scheduled-tasks'
import { app } from 'electron'
import { isAutomationMode } from './desktop-ui'
import { env } from './env'

/**
 * Background start (ADR 0057): an opt-in login item that starts only the Session Host, with no
 * window, so enabled Scheduled tasks keep firing after a reboot or logout. The operating system's
 * registration is the setting; there is no second copy to drift. macOS uses a LaunchAgent (its
 * login items cannot pass arguments), Linux an XDG autostart entry, and Windows the Run key
 * Electron manages. Every form runs `<app> -- host start`, which starts the Host and exits.
 */
const HOST_START_ARGUMENTS = ['--', 'host', 'start'] as const
/** Login items are read by the system, written only by their user. */
const LOGIN_ITEM_FILE_MODE = 0o644

function unsupported(reason: string): BackgroundStartStatus {
  return { supported: false, enabled: false, reason }
}

function launchExecutable() {
  return process.platform === 'linux' && env.APPIMAGE ? env.APPIMAGE : process.execPath
}

function macLaunchAgentPath() {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${APP_ID}.background-start.plist`)
}

function linuxAutostartPath() {
  // On Linux, Electron's appData is $XDG_CONFIG_HOME or ~/.config.
  return path.join(app.getPath('appData'), 'autostart', `${APP_ID}.background-start.desktop`)
}

function xmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function macLaunchAgentPlist(executable: string) {
  const program = [executable, ...HOST_START_ARGUMENTS]
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(`${APP_ID}.background-start`)}</string>
  <key>ProgramArguments</key>
  <array>
${program}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`
}

function desktopEntryQuote(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$')}"`
}

export function linuxAutostartEntry(executable: string) {
  return `[Desktop Entry]
Type=Application
Name=${PRODUCT_NAME} Session Host
Comment=Starts the ${PRODUCT_NAME} Session Host so Scheduled tasks keep running
Exec=${[desktopEntryQuote(executable), ...HOST_START_ARGUMENTS].join(' ')}
NoDisplay=true
X-GNOME-Autostart-enabled=true
`
}

async function fileHas(filePath: string, expected: string) {
  try {
    return (await readFile(filePath, 'utf8')) === expected
  } catch {
    return false
  }
}

async function writeOwnedFile(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, contents, { encoding: 'utf8', mode: LOGIN_ITEM_FILE_MODE })
}

function windowsLoginItem() {
  return { path: launchExecutable(), args: [...HOST_START_ARGUMENTS] }
}

function unavailableReason() {
  if (!app.isPackaged) return 'Background start is available in installed builds only.'
  if (isAutomationMode()) return 'Background start is off during automated runs.'
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) {
    return 'Background start is not available on this platform.'
  }
  return null
}

export async function readBackgroundStart(): Promise<BackgroundStartStatus> {
  const reason = unavailableReason()
  if (reason) return unsupported(reason)
  const executable = launchExecutable()
  if (process.platform === 'darwin') {
    return {
      supported: true,
      enabled: await fileHas(macLaunchAgentPath(), macLaunchAgentPlist(executable)),
    }
  }
  if (process.platform === 'linux') {
    return {
      supported: true,
      enabled: await fileHas(linuxAutostartPath(), linuxAutostartEntry(executable)),
    }
  }
  return { supported: true, enabled: app.getLoginItemSettings(windowsLoginItem()).openAtLogin }
}

async function registerFile(filePath: string, contents: string, enabled: boolean) {
  if (enabled) await writeOwnedFile(filePath, contents)
  else await rm(filePath, { force: true })
}

async function register(enabled: boolean) {
  const executable = launchExecutable()
  if (process.platform === 'darwin') {
    await registerFile(macLaunchAgentPath(), macLaunchAgentPlist(executable), enabled)
    return
  }
  if (process.platform === 'linux') {
    await registerFile(linuxAutostartPath(), linuxAutostartEntry(executable), enabled)
    return
  }
  app.setLoginItemSettings({ ...windowsLoginItem(), openAtLogin: enabled })
}

export async function writeBackgroundStart(enabled: boolean): Promise<BackgroundStartStatus> {
  const reason = unavailableReason()
  if (reason) return unsupported(reason)
  await register(enabled)
  return readBackgroundStart()
}
