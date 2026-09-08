import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectActionTerminalEnvironment } from '@shared/utils/terminal-environment'
import type { IPty } from 'node-pty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makePtyRunner } from '../terminal-pty-runner'

const INTEGRATION_APP_VERSION = '7.8.9-test'
const OUTPUT_MARKER = '__OPENWAGGLE_TERMINAL_ENV__'
const PROFILE_MARKER = '__OPENWAGGLE_PROFILE_COUNTS__'
const CAPTURE_TIMEOUT_MS = 10_000

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.runIf(process.platform !== 'win32')('terminal PTY environment integration', () => {
  it('delivers inherited user variables and terminal markers to a real login shell', async () => {
    const temporaryHome = await mkdtemp(join(tmpdir(), 'openwaggle-terminal-env-'))
    vi.stubEnv('HOME', temporaryHome)
    vi.stubEnv('SHELL', '/bin/sh')
    vi.stubEnv('PATH', '/usr/bin:/bin')
    vi.stubEnv('SSH_AUTH_SOCK', '/tmp/openwaggle-integration-agent.sock')
    vi.stubEnv('TERMINAL_INTEGRATION_CANARY', 'keep-me')
    vi.stubEnv('NODE_OPTIONS', '--require /tmp/must-not-load.cjs')
    await writeFile(
      join(temporaryHome, '.profile'),
      `OPENWAGGLE_PROFILE_LOAD_COUNT=$(( \${OPENWAGGLE_PROFILE_LOAD_COUNT:-0} + 1 ))\nexport OPENWAGGLE_PROFILE_LOAD_COUNT\n`,
    )

    let spawnedPty: IPty | null = null
    try {
      const outcome = await makePtyRunner({ appVersion: INTEGRATION_APP_VERSION }).spawn({
        cwd: temporaryHome,
        cols: 100,
        rows: 30,
        env: {},
        readinessNonce: 'environment-integration-nonce',
      })
      if (!outcome.ok) throw outcome.error
      spawnedPty = outcome.pty
      const output = await captureEnvironmentLine(outcome.pty)

      expect(output).toContain(
        `${OUTPUT_MARKER}xterm-256color|truecolor|OpenWaggle|${INTEGRATION_APP_VERSION}|keep-me|/tmp/openwaggle-integration-agent.sock|unset|1`,
      )
    } finally {
      spawnedPty?.kill()
      await rm(temporaryHome, { recursive: true, force: true })
    }
  })

  it('delivers canonical Local action context without a stale inherited worktree', async () => {
    const temporaryHome = await mkdtemp(join(tmpdir(), 'openwaggle-terminal-action-env-'))
    const actionMarker = '__OPENWAGGLE_ACTION_ENV__'
    vi.stubEnv('HOME', temporaryHome)
    vi.stubEnv('SHELL', '/bin/sh')
    vi.stubEnv('PATH', '/usr/bin:/bin')
    vi.stubEnv('T3CODE_PROJECT_ROOT', '/stale/project')
    vi.stubEnv('T3CODE_WORKTREE_PATH', '/stale/worktree')

    let spawnedPty: IPty | null = null
    try {
      const outcome = await makePtyRunner({ appVersion: INTEGRATION_APP_VERSION }).spawn({
        cwd: temporaryHome,
        cols: 100,
        rows: 30,
        env: createProjectActionTerminalEnvironment({ projectRoot: temporaryHome }),
        readinessNonce: 'action-environment-integration-nonce',
      })
      if (!outcome.ok) throw outcome.error
      spawnedPty = outcome.pty
      const expected = `${actionMarker}${temporaryHome}|unset|${temporaryHome}|unset`
      const output = await captureCommandOutput(
        outcome.pty,
        `printf '${actionMarker}%s|%s|%s|%s\n' "$T3CODE_PROJECT_ROOT" "\${T3CODE_WORKTREE_PATH-unset}" "$OPENWAGGLE_PROJECT_ROOT" "\${OPENWAGGLE_WORKTREE_PATH-unset}"\r`,
        expected,
      )

      expect(output).toContain(expected)
    } finally {
      spawnedPty?.kill()
      await rm(temporaryHome, { recursive: true, force: true })
    }
  })

  it('loads bash login config exactly once and marks only the rendered prompt as ready', async () => {
    const temporaryHome = await mkdtemp(join(tmpdir(), 'OpenWaggle terminal bash home-'))
    const readinessNonce = 'bash-real-pty-generation'
    const readinessMarker = `\u001b]633;B;${readinessNonce}\u0007`
    vi.stubEnv('HOME', temporaryHome)
    vi.stubEnv('SHELL', '/bin/bash')
    vi.stubEnv('PATH', '/usr/bin:/bin')
    await writeFile(
      join(temporaryHome, '.bash_profile'),
      `OPENWAGGLE_BASH_PROFILE_COUNT=$(( \${OPENWAGGLE_BASH_PROFILE_COUNT:-0} + 1 ))\nexport OPENWAGGLE_BASH_PROFILE_COUNT\nsource "$HOME/.bashrc"\n`,
    )
    await writeFile(
      join(temporaryHome, '.bashrc'),
      `OPENWAGGLE_BASH_RC_COUNT=$(( \${OPENWAGGLE_BASH_RC_COUNT:-0} + 1 ))\nexport OPENWAGGLE_BASH_RC_COUNT\nPROMPT_COMMAND='PS1="OPENWAGGLE_BASH_PROMPT> "'\n`,
    )

    let spawnedPty: IPty | null = null
    try {
      const outcome = await makePtyRunner({ appVersion: INTEGRATION_APP_VERSION }).spawn({
        cwd: temporaryHome,
        cols: 100,
        rows: 30,
        env: {},
        readinessNonce,
      })
      if (!outcome.ok) throw outcome.error
      spawnedPty = outcome.pty
      const promptOutput = await captureUntil(outcome.pty, readinessMarker)

      expect(promptOutput.indexOf('OPENWAGGLE_BASH_PROMPT> ')).toBeGreaterThanOrEqual(0)
      expect(promptOutput.indexOf(readinessMarker)).toBeGreaterThan(
        promptOutput.indexOf('OPENWAGGLE_BASH_PROMPT> '),
      )

      const commandOutput = await captureCommandOutput(
        outcome.pty,
        `printf '${PROFILE_MARKER}%s|%s|%s|%s\\n' "$OPENWAGGLE_BASH_PROFILE_COUNT" "$OPENWAGGLE_BASH_RC_COUNT" "$HOME" "$HISTFILE"\r`,
        `${PROFILE_MARKER}1|1|${temporaryHome}|${temporaryHome}/.bash_history`,
      )
      expect(commandOutput).toContain(
        `${PROFILE_MARKER}1|1|${temporaryHome}|${temporaryHome}/.bash_history`,
      )
    } finally {
      spawnedPty?.kill()
      await rm(temporaryHome, { recursive: true, force: true })
    }
  })

  it('loads all zsh startup stages once, restores ZDOTDIR, and ignores a stale startup marker', async () => {
    const temporaryHome = await mkdtemp(join(tmpdir(), 'OpenWaggle terminal zsh home-'))
    const initialZdotdir = join(temporaryHome, 'initial zsh config')
    const movedZdotdir = join(temporaryHome, 'moved zsh config')
    const readinessNonce = 'zsh-real-pty-generation'
    const readinessMarker = `\u001b]633;B;${readinessNonce}\u0007`
    await Promise.all([mkdir(initialZdotdir), mkdir(movedZdotdir)])
    vi.stubEnv('HOME', temporaryHome)
    vi.stubEnv('ZDOTDIR', initialZdotdir)
    vi.stubEnv('SHELL', '/bin/zsh')
    vi.stubEnv('PATH', '/usr/bin:/bin')
    await Promise.all([
      writeFile(
        join(initialZdotdir, '.zshenv'),
        `OPENWAGGLE_ZSH_ENV_COUNT=$(( \${OPENWAGGLE_ZSH_ENV_COUNT:-0} + 1 ))\nexport OPENWAGGLE_ZSH_ENV_COUNT\nexport ZDOTDIR="$HOME/moved zsh config"\n`,
      ),
      writeFile(
        join(movedZdotdir, '.zprofile'),
        `OPENWAGGLE_ZSH_PROFILE_COUNT=$(( \${OPENWAGGLE_ZSH_PROFILE_COUNT:-0} + 1 ))\nexport OPENWAGGLE_ZSH_PROFILE_COUNT\n`,
      ),
      writeFile(
        join(movedZdotdir, '.zshrc'),
        `OPENWAGGLE_ZSH_RC_COUNT=$(( \${OPENWAGGLE_ZSH_RC_COUNT:-0} + 1 ))\nexport OPENWAGGLE_ZSH_RC_COUNT\nPROMPT='OPENWAGGLE_ZSH_PROMPT> '\nprintf '\\e]633;B;stale-generation\\a'\n`,
      ),
      writeFile(
        join(movedZdotdir, '.zlogin'),
        `OPENWAGGLE_ZSH_LOGIN_COUNT=$(( \${OPENWAGGLE_ZSH_LOGIN_COUNT:-0} + 1 ))\nexport OPENWAGGLE_ZSH_LOGIN_COUNT\nprecmd_functions=()\n`,
      ),
    ])

    let spawnedPty: IPty | null = null
    try {
      const outcome = await makePtyRunner({ appVersion: INTEGRATION_APP_VERSION }).spawn({
        cwd: temporaryHome,
        cols: 100,
        rows: 30,
        env: {},
        readinessNonce,
      })
      if (!outcome.ok) throw outcome.error
      spawnedPty = outcome.pty
      const promptOutput = await captureUntil(outcome.pty, readinessMarker)

      expect(promptOutput).toContain('\u001b]633;B;stale-generation\u0007')
      expect(promptOutput.indexOf('OPENWAGGLE_ZSH_PROMPT> ')).toBeGreaterThanOrEqual(0)
      expect(promptOutput.indexOf(readinessMarker)).toBeGreaterThan(
        promptOutput.indexOf('OPENWAGGLE_ZSH_PROMPT> '),
      )

      const commandOutput = await captureCommandOutput(
        outcome.pty,
        `printf '${PROFILE_MARKER}%s|%s|%s|%s|%s\\n' "$OPENWAGGLE_ZSH_ENV_COUNT" "$OPENWAGGLE_ZSH_PROFILE_COUNT" "$OPENWAGGLE_ZSH_RC_COUNT" "$OPENWAGGLE_ZSH_LOGIN_COUNT" "$ZDOTDIR"\r`,
        `${PROFILE_MARKER}1|1|1|1|${movedZdotdir}`,
      )
      expect(commandOutput).toContain(`${PROFILE_MARKER}1|1|1|1|${movedZdotdir}`)
    } finally {
      spawnedPty?.kill()
      await rm(temporaryHome, { recursive: true, force: true })
    }
  })

  it('keeps zsh readiness when user config deliberately disables later startup files', async () => {
    const temporaryHome = await mkdtemp(join(tmpdir(), 'OpenWaggle terminal zsh rcs-off-'))
    const readinessNonce = 'zsh-rcs-off-generation'
    const readinessMarker = `\u001b]633;B;${readinessNonce}\u0007`
    vi.stubEnv('HOME', temporaryHome)
    vi.stubEnv('ZDOTDIR', temporaryHome)
    vi.stubEnv('SHELL', '/bin/zsh')
    vi.stubEnv('PATH', '/usr/bin:/bin')
    await writeFile(
      join(temporaryHome, '.zshenv'),
      `OPENWAGGLE_ZSH_ENV_COUNT=$(( \${OPENWAGGLE_ZSH_ENV_COUNT:-0} + 1 ))\nexport OPENWAGGLE_ZSH_ENV_COUNT\nPROMPT='OPENWAGGLE_ZSH_RCS_OFF> '\nunsetopt rcs\n`,
    )
    await writeFile(
      join(temporaryHome, '.zprofile'),
      'export OPENWAGGLE_ZSH_LATER_FILE_SHOULD_NOT_RUN=1\n',
    )

    let spawnedPty: IPty | null = null
    try {
      const outcome = await makePtyRunner({ appVersion: INTEGRATION_APP_VERSION }).spawn({
        cwd: temporaryHome,
        cols: 100,
        rows: 30,
        env: {},
        readinessNonce,
      })
      if (!outcome.ok) throw outcome.error
      spawnedPty = outcome.pty
      const promptOutput = await captureUntil(outcome.pty, readinessMarker)
      expect(promptOutput.indexOf(readinessMarker)).toBeGreaterThan(
        promptOutput.indexOf('OPENWAGGLE_ZSH_RCS_OFF> '),
      )

      const expected = `${PROFILE_MARKER}1|unset|${temporaryHome}`
      const commandOutput = await captureCommandOutput(
        outcome.pty,
        `printf '${PROFILE_MARKER}%s|%s|%s\\n' "$OPENWAGGLE_ZSH_ENV_COUNT" "\${OPENWAGGLE_ZSH_LATER_FILE_SHOULD_NOT_RUN-unset}" "$ZDOTDIR"\r`,
        expected,
      )
      expect(commandOutput).toContain(expected)
    } finally {
      spawnedPty?.kill()
      await rm(temporaryHome, { recursive: true, force: true })
    }
  })
})

function captureEnvironmentLine(pty: IPty) {
  return new Promise<string>((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for the terminal environment marker.'))
    }, CAPTURE_TIMEOUT_MS)
    pty.onData((data) => {
      output += data
      if (output.includes(OUTPUT_MARKER) && output.includes('|unset|1')) {
        clearTimeout(timeout)
        resolve(output)
      }
    })
    pty.onExit(({ exitCode }) => {
      clearTimeout(timeout)
      reject(new Error(`Terminal shell exited before the environment marker (exit ${exitCode}).`))
    })
    pty.write(
      `printf '${OUTPUT_MARKER}%s|%s|%s|%s|%s|%s|%s|%s\\n' "$TERM" "$COLORTERM" "$TERM_PROGRAM" "$TERM_PROGRAM_VERSION" "$TERMINAL_INTEGRATION_CANARY" "$SSH_AUTH_SOCK" "\${NODE_OPTIONS-unset}" "$OPENWAGGLE_PROFILE_LOAD_COUNT"\r`,
    )
    // The runner holds output until its consumer has installed data listeners.
    pty.resume()
  })
}

function captureCommandOutput(pty: IPty, command: string, marker: string) {
  const output = captureUntil(pty, marker)
  pty.write(command)
  return output
}

function captureUntil(pty: IPty, marker: string) {
  return new Promise<string>((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => {
      dataSubscription.dispose()
      reject(new Error(`Timed out waiting for terminal output marker ${JSON.stringify(marker)}.`))
    }, CAPTURE_TIMEOUT_MS)
    const dataSubscription = pty.onData((data) => {
      output += data
      if (!output.includes(marker)) return
      clearTimeout(timeout)
      dataSubscription.dispose()
      resolve(output)
    })
    pty.onExit(({ exitCode }) => {
      clearTimeout(timeout)
      dataSubscription.dispose()
      reject(new Error(`Terminal shell exited before output marker (exit ${exitCode}).`))
    })
    pty.resume()
  })
}
