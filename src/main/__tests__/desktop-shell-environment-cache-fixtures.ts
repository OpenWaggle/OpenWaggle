import { vi } from 'vitest'
import type { ShellEnvironmentCommand } from '../desktop-shell-environment-probes'

/** What a login-shell probe prints for one variable. */
export function captured(name: string, value: string) {
  return `__OPENWAGGLE_ENV_${name}_START__\n${value}\n__OPENWAGGLE_ENV_${name}_END__\n`
}

/**
 * A login shell that behaves like zsh with `path_helper` and a `.zshrc`: it keeps the PATH and the
 * desktop-session variables it inherits, and adds its own PATH entry in front.
 */
export function inheritingLoginShell(added: string) {
  const inherited: (Readonly<Record<string, string | undefined>> | undefined)[] = []
  const runCommand = vi.fn(async (input: ShellEnvironmentCommand) => {
    if (input.probe !== 'login-shell') return ''
    inherited.push(input.env)
    const env = input.env ?? {}
    return [
      captured('PATH', `${added}:${env.PATH ?? ''}`),
      env.XDG_SESSION_TYPE ? captured('XDG_SESSION_TYPE', env.XDG_SESSION_TYPE) : '',
      env.SSH_AUTH_SOCK ? captured('SSH_AUTH_SOCK', env.SSH_AUTH_SOCK) : '',
    ].join('')
  })
  return { runCommand, inherited }
}
