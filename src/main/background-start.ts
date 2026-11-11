import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { APP_ID, PRODUCT_NAME } from '@shared/build-identity-runtime'
import type { BackgroundStartStatus } from '@shared/types/ipc-invoke-scheduled-tasks'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { appPaths } from './desktop-shell/app-paths'
import { systemIntegration } from './desktop-shell/system-integration'
import { isAutomationMode } from './desktop-ui'

/**
 * Background start (ADR 0057): an opt-in login item that starts only the Session Host, with no
 * window, so enabled Scheduled tasks keep firing after a reboot or logout. The operating system's
 * registration is the setting; there is no second copy to drift. macOS uses a LaunchAgent (its
 * login items cannot pass arguments), Linux an XDG autostart entry, and Windows the Run key
 * the desktop shell manages. Every form runs `bun <app> -- host start`, which starts the Host and exits.
 */
const HOST_START_ARGUMENTS = ['--', 'host', 'start'] as const
/** Login items are read by the system, written only by their user. */
const LOGIN_ITEM_FILE_MODE = 0o644

function unsupported(reason: string) {
  return { supported: false, enabled: false, reason } satisfies BackgroundStartStatus
}

/** Bun and the app directory whose `package.json` `main` it runs. */
function launchCommand(): readonly [string, ...string[]] {
  return [process.execPath, appPaths.appRoot()]
}

function macLaunchAgentPath() {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${APP_ID}.background-start.plist`)
}

function linuxAutostartPath() {
  // On Linux, appData is $XDG_CONFIG_HOME or ~/.config.
  return path.join(appPaths.appData(), 'autostart', `${APP_ID}.background-start.desktop`)
}

function xmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function macLaunchAgentPlist(command: readonly string[]) {
  const program = [...command, ...HOST_START_ARGUMENTS]
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

export function linuxAutostartEntry(command: readonly string[]) {
  return `[Desktop Entry]
Type=Application
Name=${PRODUCT_NAME} Session Host
Comment=Starts the ${PRODUCT_NAME} Session Host so Scheduled tasks keep running
Exec=${[...command.map(desktopEntryQuote), ...HOST_START_ARGUMENTS].join(' ')}
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
  const [executable, ...args] = launchCommand()
  return { path: executable, args: [...args, ...HOST_START_ARGUMENTS] }
}

function unavailableReason() {
  if (!appLifecycle.isPackaged()) return 'Background start is available in installed builds only.'
  if (isAutomationMode()) return 'Background start is off during automated runs.'
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) {
    return 'Background start is not available on this platform.'
  }
  return null
}

export async function readBackgroundStart() {
  const reason = unavailableReason()
  if (reason) return unsupported(reason)
  const command = launchCommand()
  if (process.platform === 'darwin') {
    return {
      supported: true,
      enabled: await fileHas(macLaunchAgentPath(), macLaunchAgentPlist(command)),
    } satisfies BackgroundStartStatus
  }
  if (process.platform === 'linux') {
    return {
      supported: true,
      enabled: await fileHas(linuxAutostartPath(), linuxAutostartEntry(command)),
    } satisfies BackgroundStartStatus
  }
  return {
    supported: true,
    enabled: systemIntegration.loginItemOpensAtLogin(windowsLoginItem()),
  } satisfies BackgroundStartStatus
}

async function registerFile(filePath: string, contents: string, enabled: boolean) {
  if (enabled) await writeOwnedFile(filePath, contents)
  else await rm(filePath, { force: true })
}

async function register(enabled: boolean) {
  const command = launchCommand()
  if (process.platform === 'darwin') {
    await registerFile(macLaunchAgentPath(), macLaunchAgentPlist(command), enabled)
    return
  }
  if (process.platform === 'linux') {
    await registerFile(linuxAutostartPath(), linuxAutostartEntry(command), enabled)
    return
  }
  systemIntegration.setLoginItemOpensAtLogin(windowsLoginItem(), enabled)
}

export async function writeBackgroundStart(enabled: boolean) {
  const reason = unavailableReason()
  if (reason) return unsupported(reason)
  await register(enabled)
  return readBackgroundStart()
}
