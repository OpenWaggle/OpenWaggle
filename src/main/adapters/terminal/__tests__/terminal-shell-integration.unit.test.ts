import { access, readFile, stat } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { TerminalShellCandidate } from '../terminal-shell'
import {
  type PreparedTerminalShellLaunch,
  prepareTerminalShellLaunch,
  terminalReadinessMarker,
} from '../terminal-shell-integration'

const NONCE = 'generation_A-123'
const MARKER = `\u001b]633;B;${NONCE}\u0007`
const BASE_ENVIRONMENT = {
  HOME: "/Users/Terminal User's Home",
  PATH: '/custom/bin:/usr/bin:/bin',
  SSH_AUTH_SOCK: '/tmp/agent socket',
  TERM: 'xterm-256color',
}

const launches: PreparedTerminalShellLaunch[] = []

afterEach(async () => {
  await Promise.all(launches.splice(0).map((launch) => launch.cleanup()))
})

describe('terminal shell prompt-readiness integration', () => {
  it('builds the exact nonce-scoped marker and rejects shell metacharacters', () => {
    expect(terminalReadinessMarker(NONCE)).toBe(MARKER)
    expect(() => terminalReadinessMarker('nonce;printf BAD')).toThrow(/base64url/u)
  })

  it('leaves unknown shells untouched with no guessed readiness', async () => {
    const launch = await prepare(
      { command: '/opt/custom shells/acme-shell', args: [], label: 'acme-shell' },
      NONCE,
    )

    expect(launch).toMatchObject({ args: [], integrated: false })
    expect(launch.environment).toEqual(BASE_ENVIRONMENT)
    expect(JSON.stringify(launch)).not.toContain('633;B')
  })

  it('wraps every zsh startup stage in a private ZDOTDIR and restores dynamic user config', async () => {
    const launch = await prepare(
      { command: '/Applications/Z Shell/bin/zsh', args: ['-l', '-i'], label: 'zsh' },
      NONCE,
      { ...BASE_ENVIRONMENT, ZDOTDIR: "/Users/Terminal User's Home/.config/zsh" },
    )
    const integrationDirectory = launch.environment.ZDOTDIR
    if (integrationDirectory === undefined) throw new Error('Expected an integration ZDOTDIR.')

    expect(launch.args).toEqual(['-l', '-i'])
    expect(launch.integrated).toBe(true)
    expect(integrationDirectory).toContain('OpenWaggle terminal zsh-')
    expect(launch.environment.SSH_AUTH_SOCK).toBe(BASE_ENVIRONMENT.SSH_AUTH_SOCK)

    const startupFiles = ['.zshenv', '.zprofile', '.zshrc', '.zlogin'] as const
    const scripts = await Promise.all(
      startupFiles.map((file) => readFile(`${integrationDirectory}/${file}`, 'utf8')),
    )
    for (const [index, script] of scripts.entries()) {
      expect(script).toContain(`/${startupFiles[index]}`)
      expect(script).toContain('builtin source')
    }
    expect(scripts[2]).toContain(`\\e]633;B;${NONCE}\\a`)
    expect(scripts[3]).toContain(`\\e]633;B;${NONCE}\\a`)
    expect(scripts[3]).toContain('unset __openwaggle_user_zdotdir_')

    if (process.platform !== 'win32') {
      expect((await stat(integrationDirectory)).mode & 0o777).toBe(0o700)
      expect((await stat(`${integrationDirectory}/.zshrc`)).mode & 0o777).toBe(0o600)
    }

    await launch.cleanup()
    await expect(access(integrationDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses a login bash profile wrapper without losing a spaced or quoted HOME', async () => {
    const launch = await prepare(
      { command: '/bin/bash', args: ['--login', '-i'], label: 'bash' },
      NONCE,
    )
    const integrationHome = launch.environment.HOME
    if (integrationHome === undefined) throw new Error('Expected an integration HOME.')
    const script = await readFile(`${integrationHome}/.bash_profile`, 'utf8')

    expect(launch.args).toEqual(['--login', '-i'])
    expect(integrationHome).toContain('OpenWaggle terminal bash-')
    expect(script).toContain(`export HOME='/Users/Terminal User'\\''s Home'`)
    expect(script).toContain('if [[ -r "$HOME/.bash_profile" ]]')
    expect(script).toContain('elif [[ -r "$HOME/.bash_login" ]]')
    expect(script).toContain('elif [[ -r "$HOME/.profile" ]]')
    expect(script).toContain(`\\[\\e]633;B;${NONCE}\\a\\]`)
    expect(script).toContain('PROMPT_COMMAND+=')
  })

  it('injects fish only after native config and emits from the rendered prompt', async () => {
    const launch = await prepare({
      command: '/opt/homebrew/bin/fish',
      args: ['--login', '--interactive'],
      label: 'fish',
    })

    expect(launch.args.slice(0, 2)).toEqual(['--login', '--interactive'])
    expect(launch.args[2]).toBe('--init-command')
    expect(launch.args[3]).toContain('functions --copy fish_prompt')
    expect(launch.args[3]).toContain(`printf '\\e]633;B;${NONCE}\\a'`)
    expect(launch.environment).toEqual(BASE_ENVIRONMENT)
  })

  it('loads PowerShell profiles before wrapping their prompt result', async () => {
    const launch = await prepare({
      command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: ['-NoLogo'],
      label: 'pwsh.exe',
    })

    expect(launch.args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-Command'])
    expect(launch.args[3]).toContain('OriginalPrompt = $function:Prompt')
    expect(launch.args[3]).toContain(`633;B;${NONCE}`)
    expect(launch.args[3]).toContain('.OriginalPrompt.Invoke()')
  })

  it('runs cmd integration after AutoRun and preserves the resulting prompt', async () => {
    const launch = await prepare({ command: 'cmd.exe', args: [], label: 'cmd.exe' })
    const scriptPath = launch.args[1]
    if (scriptPath === undefined) throw new Error('Expected a cmd integration script.')
    const script = await readFile(scriptPath, 'utf8')

    expect(launch.args[0]).toBe('/K')
    expect(scriptPath).toContain('OpenWaggle terminal cmd-')
    expect(script).toContain('if not defined PROMPT set "PROMPT=$P$G"')
    expect(script).toContain(`!PROMPT!$E]633;B;${NONCE}${String.fromCharCode(7)}`)
    expect(script).toContain('endlocal ^& set "PROMPT=%%A"')
  })

  it('scopes generated shell state and markers to each spawn nonce', async () => {
    const first = await prepare(
      { command: '/bin/bash', args: ['--login', '-i'], label: 'bash' },
      'first-generation',
    )
    const second = await prepare(
      { command: '/bin/bash', args: ['--login', '-i'], label: 'bash' },
      'second-generation',
    )
    const firstScript = await readFile(`${first.environment.HOME}/.bash_profile`, 'utf8')
    const secondScript = await readFile(`${second.environment.HOME}/.bash_profile`, 'utf8')

    expect(firstScript).toContain('633;B;first-generation')
    expect(firstScript).not.toContain('second-generation')
    expect(secondScript).toContain('633;B;second-generation')
    expect(secondScript).not.toContain('first-generation')
  })
})

async function prepare(
  candidate: TerminalShellCandidate,
  readinessNonce = NONCE,
  environment: Readonly<Record<string, string>> = BASE_ENVIRONMENT,
) {
  const launch = await prepareTerminalShellLaunch(candidate, environment, readinessNonce)
  launches.push(launch)
  return launch
}
