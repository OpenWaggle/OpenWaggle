import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TerminalShellCandidate } from './terminal-shell'
import {
  buildBashProfileWrapper,
  buildCmdPromptIntegration,
  buildFishPromptIntegration,
  buildPowerShellPromptIntegration,
  buildZshStartupScripts,
} from './terminal-shell-integration-scripts'

const OSC = '\u001b]'
const BEL = '\u0007'
const READINESS_NONCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

export interface PreparedTerminalShellLaunch {
  readonly args: readonly string[]
  readonly environment: Record<string, string>
  readonly integrated: boolean
  readonly cleanup: () => Promise<void>
}

/** Exact, generation-scoped prompt-end marker accepted by the runtime detector. */
export function terminalReadinessMarker(readinessNonce: string) {
  assertReadinessNonce(readinessNonce)
  return `${OSC}633;B;${readinessNonce}${BEL}`
}

/**
 * Add a readiness marker at the native prompt boundary for known shells.
 * Unknown shells remain untouched so the runtime can offer its explicit
 * "Send now" escape hatch instead of guessing incompatible startup flags.
 */
export async function prepareTerminalShellLaunch(
  candidate: TerminalShellCandidate,
  environment: Readonly<Record<string, string>>,
  readinessNonce: string,
): Promise<PreparedTerminalShellLaunch> {
  assertReadinessNonce(readinessNonce)
  const shell = shellExecutableName(candidate.command).toLowerCase()

  if (shell === 'zsh') return prepareZshLaunch(candidate, environment, readinessNonce)
  if (shell === 'bash') return prepareBashLaunch(candidate, environment, readinessNonce)
  if (shell === 'fish') return prepareFishLaunch(candidate, environment, readinessNonce)
  if (
    shell === 'pwsh' ||
    shell === 'pwsh.exe' ||
    shell === 'powershell' ||
    shell === 'powershell.exe'
  ) {
    return preparePowerShellLaunch(candidate, environment, readinessNonce)
  }
  if (shell === 'cmd' || shell === 'cmd.exe') {
    return prepareCmdLaunch(candidate, environment, readinessNonce)
  }

  return {
    args: candidate.args,
    environment: { ...environment },
    integrated: false,
    cleanup: noCleanup,
  }
}

async function prepareZshLaunch(
  candidate: TerminalShellCandidate,
  environment: Readonly<Record<string, string>>,
  readinessNonce: string,
): Promise<PreparedTerminalShellLaunch> {
  const directory = await makePrivateIntegrationDirectory('zsh')
  const originalZdotdir = environment.ZDOTDIR
  const scripts = buildZshStartupScripts({ directory, originalZdotdir, readinessNonce })

  try {
    await Promise.all(
      Object.entries(scripts).map(([fileName, contents]) =>
        writePrivateFile(join(directory, fileName), contents),
      ),
    )
  } catch (error) {
    await removeIntegrationDirectory(directory)
    throw error
  }

  return {
    args: candidate.args,
    environment: { ...environment, ZDOTDIR: directory },
    integrated: true,
    cleanup: cleanupDirectoryOnce(directory),
  }
}

async function prepareBashLaunch(
  candidate: TerminalShellCandidate,
  environment: Readonly<Record<string, string>>,
  readinessNonce: string,
): Promise<PreparedTerminalShellLaunch> {
  const directory = await makePrivateIntegrationDirectory('bash')
  const originalHome = environment.HOME ?? homedir()

  try {
    await writePrivateFile(
      join(directory, '.bash_profile'),
      buildBashProfileWrapper({
        integrationHome: directory,
        originalHome,
        readinessNonce,
      }),
    )
  } catch (error) {
    await removeIntegrationDirectory(directory)
    throw error
  }

  return {
    args: candidate.args,
    environment: { ...environment, HOME: directory },
    integrated: true,
    cleanup: cleanupDirectoryOnce(directory),
  }
}

function prepareFishLaunch(
  candidate: TerminalShellCandidate,
  environment: Readonly<Record<string, string>>,
  readinessNonce: string,
): PreparedTerminalShellLaunch {
  return {
    args: [...candidate.args, '--init-command', buildFishPromptIntegration(readinessNonce)],
    environment: { ...environment },
    integrated: true,
    cleanup: noCleanup,
  }
}

function preparePowerShellLaunch(
  candidate: TerminalShellCandidate,
  environment: Readonly<Record<string, string>>,
  readinessNonce: string,
): PreparedTerminalShellLaunch {
  return {
    args: [
      ...candidate.args,
      '-NoExit',
      '-Command',
      buildPowerShellPromptIntegration(readinessNonce),
    ],
    environment: { ...environment },
    integrated: true,
    cleanup: noCleanup,
  }
}

async function prepareCmdLaunch(
  candidate: TerminalShellCandidate,
  environment: Readonly<Record<string, string>>,
  readinessNonce: string,
): Promise<PreparedTerminalShellLaunch> {
  const directory = await makePrivateIntegrationDirectory('cmd')
  const scriptPath = join(directory, 'prompt-readiness.cmd')
  try {
    await writePrivateFile(scriptPath, buildCmdPromptIntegration(readinessNonce))
  } catch (error) {
    await removeIntegrationDirectory(directory)
    throw error
  }
  return {
    args: [...candidate.args, '/K', scriptPath],
    environment: { ...environment },
    integrated: true,
    cleanup: cleanupDirectoryOnce(directory),
  }
}

function assertReadinessNonce(readinessNonce: string) {
  if (!READINESS_NONCE_PATTERN.test(readinessNonce)) {
    throw new Error('Terminal readiness nonce must be a non-empty base64url token.')
  }
}

function shellExecutableName(command: string) {
  const normalized = command.replaceAll('\\', '/')
  return normalized.split('/').pop() ?? command
}

async function makePrivateIntegrationDirectory(shell: string) {
  const directory = await mkdtemp(join(tmpdir(), `OpenWaggle terminal ${shell}-`))
  await chmod(directory, PRIVATE_DIRECTORY_MODE)
  return directory
}

async function writePrivateFile(path: string, contents: string) {
  await writeFile(path, contents, { encoding: 'utf8', mode: PRIVATE_FILE_MODE })
}

function cleanupDirectoryOnce(directory: string) {
  let cleanupPromise: Promise<void> | undefined
  return () => {
    cleanupPromise ??= removeIntegrationDirectory(directory)
    return cleanupPromise
  }
}

async function removeIntegrationDirectory(directory: string) {
  await rm(directory, { recursive: true, force: true })
}

async function noCleanup() {}
