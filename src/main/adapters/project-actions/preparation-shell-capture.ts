import { basename } from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import type { ResolvedActionInvocation } from '@shared/types/action-definitions'
import { quotePosixShellArgument, quotePowerShellArgument } from '@shared/utils/shell-argument'
import { resolveActionExecutablePath } from './action-process'
import { enableEscapedExecCapture } from './preparation-escaped-exec'

// macOS env(1) does not promise -0; the bundled Perl keeps embedded newlines intact.
const POSIX_ENVIRONMENT_DUMP =
  process.platform === 'darwin'
    ? `/usr/bin/perl -e 'for my $key (keys %ENV) { print "$key=$ENV{$key}\\0" }'`
    : '/usr/bin/env -0'

const CAPTURE_SHELLS = new Set([
  'pwsh',
  'pwsh.exe',
  'powershell',
  'powershell.exe',
  'fish',
  'bash',
  'zsh',
  'sh',
  'dash',
  'ksh',
  'mksh',
])

export function supportsPreparationCaptureShell(shell: string) {
  return CAPTURE_SHELLS.has(basename(shell).toLowerCase())
}

function invocationCommand(invocation: ResolvedActionInvocation, quote: (value: string) => string) {
  return invocation.type === 'command'
    ? invocation.command
    : [invocation.executable, ...invocation.args].map(quote).join(' ')
}

function posixInvocationCommand(invocation: ResolvedActionInvocation) {
  return invocation.type === 'command'
    ? enableEscapedExecCapture(invocation.command)
    : invocationCommand(invocation, quotePosixShellArgument)
}

const posixDumpOnSuccess = (destination: string) =>
  `if [ "$__ow_exit" -eq 0 ]; then ${POSIX_ENVIRONMENT_DUMP} > ${quotePosixShellArgument(destination)} || __ow_exit=$?; fi`

// A command substitution snapshots before exec without splitting per-command assignments from it.
// The alias also leaves redirect-only exec as a real shell builtin.
const posixCaptureBeforeExec = (destination: string) =>
  `__ow_capture_exec() {\n${POSIX_ENVIRONMENT_DUMP} > ${quotePosixShellArgument(destination)} || return $?\n}`

// Evaluate a saved trap immediately after a command with the setup's original status.
// The nonzero branch uses an OR-list so errexit cannot skip the user's cleanup.
const posixRunUserExitTrap = [
  'if [ -n "$__ow_user_exit_trap" ]; then',
  'if [ "$__ow_setup_exit" -eq 0 ]; then',
  'eval "$__ow_user_exit_trap"',
  'else',
  '(exit "$__ow_setup_exit") || eval "$__ow_user_exit_trap"',
  'fi',
  'fi',
].join('\n')

// Prefixed trap must reach the saved-trap handler. The aliases snapshot before
// temporary command assignments, preserving prefixed exec's environment semantics.
const bashZshPrefixedBuiltins = [
  '__ow_command() {',
  'case "$1" in',
  'trap) shift; trap "$@" ;;',
  'exec) shift; command exec "$@" ;;',
  '*) command "$@" ;;',
  'esac',
  '}',
  '__ow_builtin() {',
  'case "$1" in',
  'trap) shift; trap "$@" ;;',
  'exec) shift; builtin exec "$@" ;;',
  '*) builtin "$@" ;;',
  'esac',
  '}',
].join('\n')

function shPrefixedCommand(name: string) {
  // Ksh-style functions preserve temporary assignment export behavior in ksh.
  const functionStart =
    name === 'ksh' || name === 'mksh' ? 'function __ow_command {' : '__ow_command() {'
  return [
    functionStart,
    'case "$1" in',
    'trap) shift; __ow_trap "$@" ;;',
    'exec) shift; command exec "$@" ;;',
    '*) command "$@" ;;',
    'esac',
    '}',
  ].join('\n')
}

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
        '__ow_setup_exit=$1',
        'builtin trap - EXIT',
        posixDumpOnSuccess(destination),
        posixRunUserExitTrap,
        'exit "$__ow_exit"',
        '}',
      ].join('\n')
      // Preserve the capture trap when a sourced setup script registers its own EXIT cleanup.
      const userTraps = [
        'trap() {',
        'if [ "$#" -eq 0 ] || [ "$1" = \'-p\' ] || [ "$1" = \'-l\' ]; then builtin trap "$@"; return; fi',
        'if [ "$1" = \'--\' ]; then shift; fi',
        'if [ "$#" -eq 1 ]; then case "$1" in EXIT|0) __ow_user_exit_trap=\'\'; return ;; *) builtin trap "$@"; return ;; esac; fi',
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
      const command = posixInvocationCommand(resolved)
      const enableAliases = name === 'bash' ? 'shopt -s expand_aliases\n' : ''
      return `umask 077\n__ow_user_exit_trap=''\n${finish}\nbuiltin trap '__ow_finish "$?"' EXIT\n${userTraps}\n${posixCaptureBeforeExec(destination)}\n${bashZshPrefixedBuiltins}\n${enableAliases}alias exec='exec $(__ow_capture_exec)'\nalias command='__ow_command $(__ow_capture_exec)'\nalias builtin='__ow_builtin $(__ow_capture_exec)'\neval ${quotePosixShellArgument(command)}\n__ow_finish "$?"`
    })
    .with('sh', 'dash', 'ksh', 'mksh', () => {
      const finish = [
        '__ow_finish() {',
        '__ow_exit=$1',
        '__ow_setup_exit=$1',
        'command trap - EXIT',
        posixDumpOnSuccess(destination),
        posixRunUserExitTrap,
        'exit "$__ow_exit"',
        '}',
      ].join('\n')
      // These shells reject a function named trap. Parse user code after the alias is installed.
      const userTraps = [
        '__ow_trap() {',
        'if [ "$#" -eq 0 ] || [ "$1" = \'-p\' ] || [ "$1" = \'-l\' ]; then command trap "$@"; return; fi',
        'if [ "$1" = \'--\' ]; then shift; fi',
        'if [ "$#" -eq 1 ]; then case "$1" in EXIT|0) __ow_user_exit_trap=\'\'; return ;; *) command trap "$@"; return ;; esac; fi',
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
      const command = posixInvocationCommand(resolved)
      return `umask 077\n__ow_user_exit_trap=''\n${finish}\ncommand trap '__ow_finish "$?"' EXIT\n${userTraps}\n${posixCaptureBeforeExec(destination)}\n${shPrefixedCommand(name)}\nalias trap=__ow_trap\nalias exec='exec $(__ow_capture_exec)'\nalias command='__ow_command $(__ow_capture_exec)'\neval ${quotePosixShellArgument(command)}\n__ow_finish "$?"`
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
