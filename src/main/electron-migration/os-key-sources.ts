/**
 * Where each OS keeps the key Electron's `safeStorage` used, read without Electron:
 * - macOS: the login keychain item, read in-process through a `Bun.secrets`-shaped store. The read
 *   is silent only when the reading executable satisfies the item's ACL (see
 *   docs/electrobun-transition.md, "macOS keychain").
 * - Linux: the Secret Service item Chromium's os_crypt stores (`secret-tool lookup application
 *   <app>`, as browser import does), then KWallet (`kwallet-query`).
 * - Windows: `os_crypt.encrypted_key` from `Local State` (under `session-data`, or the profile root
 *   of installs from before it), unwrapped with DPAPI through PowerShell.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ElectronSafeStorageKeySources,
  ElectronSafeStoragePlatform,
} from './electron-safe-storage'

export interface CommandResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  input?: string,
) => Promise<CommandResult>

export interface KeychainReader {
  readonly get: (options: {
    readonly service: string
    readonly name: string
  }) => Promise<string | null>
}

export interface OsKeySourceOptions {
  readonly platform: ElectronSafeStoragePlatform
  readonly appName: string
  readonly userData: string
  readonly keychain?: KeychainReader
  readonly runCommand: CommandRunner
  readonly powershellPath?: string
}

const DPAPI_UNPROTECT_SCRIPT =
  'Add-Type -AssemblyName System.Security;' +
  '$value=[Console]::In.ReadToEnd();' +
  '$encrypted=[Convert]::FromBase64String($value);' +
  '$plain=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);' +
  '[Console]::Out.Write([Convert]::ToBase64String($plain))'

function trimmedLine(text: string) {
  return text.replace(/\r?\n$/u, '')
}

async function readLinuxKeyring(options: OsKeySourceOptions, application: string) {
  const secretTool = await options.runCommand('secret-tool', ['lookup', 'application', application])
  const secret = trimmedLine(secretTool.stdout)
  if (secretTool.exitCode === 0 && secret.length > 0) return secret
  // Electron on KDE stores the password in KWallet under "<app> Keys" / "<app> Safe Storage".
  const kwallet = await options
    .runCommand('kwallet-query', [
      '-r',
      `${application} Safe Storage`,
      '-f',
      `${application} Keys`,
      'kdewallet',
    ])
    .catch(() => undefined)
  const fromKwallet = kwallet?.exitCode === 0 ? trimmedLine(kwallet.stdout) : ''
  if (fromKwallet.length > 0) return fromKwallet
  if (/denied|cancel|locked|dismissed/iu.test(secretTool.stderr)) {
    throw new Error(`The desktop keyring refused access: ${secretTool.stderr.trim()}`)
  }
  return null
}

async function readLocalStates(userData: string) {
  const candidates = [
    path.join(userData, 'session-data', 'Local State'),
    path.join(userData, 'Local State'),
  ]
  // Read in parallel; the result keeps the candidates' priority order.
  const contents = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return await readFile(candidate, 'utf8')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        return undefined
      }
    }),
  )
  return contents.filter((content) => content !== undefined)
}

async function unprotectWithPowerShell(options: OsKeySourceOptions, data: Buffer) {
  const result = await options.runCommand(
    options.powershellPath ?? 'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-Command',
      DPAPI_UNPROTECT_SCRIPT,
    ],
    data.toString('base64'),
  )
  if (result.exitCode !== 0) throw new Error(`DPAPI unprotect failed: ${result.stderr.trim()}`)
  return Buffer.from(result.stdout.trim(), 'base64')
}

export function createOsKeySources(options: OsKeySourceOptions) {
  const base = { platform: options.platform, appName: options.appName }
  if (options.platform === 'darwin') {
    const keychain = options.keychain
    const sources: ElectronSafeStorageKeySources = {
      ...base,
      ...(keychain
        ? {
            readKeychainPassword: (service: string, account: string) =>
              keychain.get({ service, name: account }),
          }
        : {}),
    }
    return sources
  }
  if (options.platform === 'linux') {
    const sources: ElectronSafeStorageKeySources = {
      ...base,
      readLinuxKeyringPassword: (application) => readLinuxKeyring(options, application),
    }
    return sources
  }
  const sources: ElectronSafeStorageKeySources = {
    ...base,
    readWindowsLocalStates: () => readLocalStates(options.userData),
    unprotectDpapi: (data) => unprotectWithPowerShell(options, data),
  }
  return sources
}
