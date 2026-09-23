import { basename } from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import type { ResolvedActionInvocation } from '@shared/types/action-definitions'
import { quotePosixShellArgument, quotePowerShellArgument } from '@shared/utils/shell-argument'
import { resolveActionExecutablePath } from './action-process'

// macOS env(1) does not promise -0; the bundled Perl keeps embedded newlines intact.
const POSIX_ENVIRONMENT_DUMP =
  process.platform === 'darwin'
    ? `/usr/bin/perl -e 'for my $key (keys %ENV) { print "$key=$ENV{$key}\\0" }'`
    : '/usr/bin/env -0'

function invocationCommand(invocation: ResolvedActionInvocation, quote: (value: string) => string) {
  return invocation.type === 'command'
    ? invocation.command
    : [invocation.executable, ...invocation.args].map(quote).join(' ')
}

const posixDumpOnSuccess = (destination: string) =>
  `if [ "$__ow_exit" -eq 0 ]; then ${POSIX_ENVIRONMENT_DUMP} > ${quotePosixShellArgument(destination)} || __ow_exit=$?; fi`

// A command substitution snapshots before exec without splitting per-command assignments from it.
// The alias also leaves redirect-only exec as a real shell builtin.
const posixCaptureBeforeExec = (destination: string) =>
  `__ow_capture_exec() {\n${POSIX_ENVIRONMENT_DUMP} > ${quotePosixShellArgument(destination)} || return $?\n}`

export async function preparationCaptureInvocation(
  invocation: ResolvedActionInvocation,
  destination: string,
  shell: string,
  environment: Readonly<Record<string, string>>,
): Promise<{ readonly invocation: ResolvedActionInvocation; readonly format: 'nul' | 'json' }> {
  const resolved =
    invocation.type === 'executable'
      ? {
          ...invocation,
          executable: await resolveActionExecutablePath(
            invocation.executable,
            environment,
            invocation.cwd,
          ),
        }
      : invocation
  const name = basename(shell).toLowerCase()
  if (['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(name)) {
    const command = `${resolved.type === 'executable' ? '& ' : ''}${invocationCommand(resolved, quotePowerShellArgument)}`
    // An explicit exit 0 skips the post-command assignment but still runs finally.
    return {
      format: 'json',
      invocation: {
        type: 'executable',
        cwd: invocation.cwd,
        executable: shell,
        args: [
          '-NoLogo',
          '-NonInteractive',
          '-Command',
          `$global:LASTEXITCODE = 0\n$__ow_exit = 0\ntry {\n${command}\nif ($?) { $__ow_exit = 0 } elseif ($global:LASTEXITCODE -ne 0) { $__ow_exit = $global:LASTEXITCODE }\n} catch {\n$__ow_exit = 1\nthrow\n} finally {\nif ($__ow_exit -eq 0) { $values = @{}; Get-ChildItem Env: | ForEach-Object { $values[$_.Name] = $_.Value }; [System.IO.File]::WriteAllText(${quotePowerShellArgument(destination)}, ($values | ConvertTo-Json -Compress)) }\n}\nexit $__ow_exit`,
        ],
      },
    }
  }
  const script = match(name)
    .with('fish', () => {
      const quote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
      return `umask 077\nfunction __ow_capture --on-event fish_exit\nset -l __ow_exit $status\nif test $__ow_exit -eq 0\ncommand ${POSIX_ENVIRONMENT_DUMP} > ${quote(destination)}\nend\nend\n${invocationCommand(resolved, quote)}`
    })
    .with('bash', 'zsh', () => {
      const finish = [
        '__ow_finish() {',
        '__ow_exit=$1',
        'builtin trap - EXIT',
        posixDumpOnSuccess(destination),
        'if [ -n "$__ow_user_exit_trap" ]; then eval "$__ow_user_exit_trap"; fi',
        'exit "$__ow_exit"',
        '}',
      ].join('\n')
      // Preserve the capture trap when a sourced setup script registers its own EXIT cleanup.
      const userTraps = [
        'trap() {',
        'if [ "$#" -eq 0 ] || [ "$1" = \'-p\' ] || [ "$1" = \'-l\' ]; then builtin trap "$@"; return; fi',
        'if [ "$1" = \'--\' ]; then shift; fi',
        'if [ "$#" -lt 2 ]; then builtin trap "$@"; return; fi',
        'local __ow_handler="$1" __ow_signal',
        'shift',
        'for __ow_signal in "$@"; do',
        'case "$__ow_signal" in',
        'EXIT|0) if [ "$__ow_handler" = \'-\' ]; then __ow_user_exit_trap=\'\'; else __ow_user_exit_trap="$__ow_handler"; fi ;;',
        '*) builtin trap "$__ow_handler" "$__ow_signal" ;;',
        'esac',
        'done',
        '}',
      ].join('\n')
      const command = invocationCommand(resolved, quotePosixShellArgument)
      const enableAliases = name === 'bash' ? 'shopt -s expand_aliases\n' : ''
      return `umask 077\n__ow_user_exit_trap=''\n${finish}\nbuiltin trap '__ow_finish "$?"' EXIT\n${userTraps}\n${posixCaptureBeforeExec(destination)}\n${enableAliases}alias exec='exec $(__ow_capture_exec)'\neval ${quotePosixShellArgument(command)}\n__ow_finish "$?"`
    })
    .with('sh', 'dash', 'ksh', 'mksh', () => {
      const finish = [
        '__ow_finish() {',
        '__ow_exit=$1',
        'command trap - EXIT',
        posixDumpOnSuccess(destination),
        'if [ -n "$__ow_user_exit_trap" ]; then eval "$__ow_user_exit_trap"; fi',
        'exit "$__ow_exit"',
        '}',
      ].join('\n')
      // These shells reject a function named trap. Parse user code after the alias is installed.
      const userTraps = [
        '__ow_trap() {',
        'if [ "$#" -eq 0 ] || [ "$1" = \'-p\' ] || [ "$1" = \'-l\' ]; then command trap "$@"; return; fi',
        'if [ "$1" = \'--\' ]; then shift; fi',
        'if [ "$#" -lt 2 ]; then command trap "$@"; return; fi',
        '__ow_handler="$1"',
        'shift',
        'for __ow_signal in "$@"; do',
        'case "$__ow_signal" in',
        'EXIT|0) if [ "$__ow_handler" = \'-\' ]; then __ow_user_exit_trap=\'\'; else __ow_user_exit_trap="$__ow_handler"; fi ;;',
        '*) command trap "$__ow_handler" "$__ow_signal" ;;',
        'esac',
        'done',
        '}',
      ].join('\n')
      const command = invocationCommand(resolved, quotePosixShellArgument)
      return `umask 077\n__ow_user_exit_trap=''\n${finish}\ncommand trap '__ow_finish "$?"' EXIT\n${userTraps}\n${posixCaptureBeforeExec(destination)}\nalias trap=__ow_trap\nalias exec='exec $(__ow_capture_exec)'\neval ${quotePosixShellArgument(command)}\n__ow_finish "$?"`
    })
    .otherwise(() => {
      throw new Error(
        `Setup environment capture is not supported by the configured shell: ${shell}.`,
      )
    })
  return {
    format: 'nul',
    invocation: {
      type: 'executable',
      cwd: invocation.cwd,
      executable: shell,
      args: ['-c', script],
    },
  }
}
