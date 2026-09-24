import { basename } from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import type { ResolvedActionInvocation } from '@shared/types/action-definitions'
import { quotePosixShellArgument, quotePowerShellArgument } from '@shared/utils/shell-argument'
import { resolveActionExecutablePath } from './action-process'
import { powerShellFailureExitCode } from './powershell-failure-exit'
import { commandOptionCases } from './preparation-command-option-cases'
import { enableEscapedExecCapture } from './preparation-escaped-exec'
import { runtimeEvalRewriter } from './preparation-eval-rewriter'
import { runtimeFishEvalRewriter } from './preparation-fish-eval-rewriter'
import { captureFishExec } from './preparation-fish-exec'
import type { QuotedBuiltinSyntax } from './preparation-quoted-builtin'
import { quotedBuiltinSyntaxForShell } from './preparation-quoted-builtin-syntax'

// macOS env(1) does not promise -0; the bundled Perl keeps embedded newlines intact.
const POSIX_ENVIRONMENT_DUMP =
  process.platform === 'darwin'
    ? `/usr/bin/perl -e 'for my $key (keys %ENV) { print "$key=$ENV{$key}\\0" }'`
    : '/usr/bin/env -0'

const POWERSHELL_SETUP_HEADER_LINES = 3

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

function posixInvocationCommand(invocation: ResolvedActionInvocation, syntax: QuotedBuiltinSyntax) {
  return invocation.type === 'command'
    ? enableEscapedExecCapture(invocation.command, syntax)
    : invocationCommand(invocation, quotePosixShellArgument)
}

const posixDumpOnSuccess = (destination: string) =>
  `if [ "$__ow_exit" -eq 0 ]; then ${POSIX_ENVIRONMENT_DUMP} > ${quotePosixShellArgument(destination)} && __ow_mark_export || __ow_exit=$?; fi`

// A command substitution snapshots before exec without splitting per-command assignments from it.
// The alias also leaves redirect-only exec as a real shell builtin.
const posixCaptureBeforeExec = (destination: string) =>
  `__ow_mark_export() { : > ${quotePosixShellArgument(`${destination}.verified`)}; }
__ow_capture_exec() {
${POSIX_ENVIRONMENT_DUMP} > ${quotePosixShellArgument(destination)} || return $?
if [ "$1" = final ]; then __ow_mark_export || return $?; fi
}`

function posixRuntimeEvalCapture(evalBuiltin: 'builtin' | 'command', syntax: QuotedBuiltinSyntax) {
  return [
    '__ow_eval() {',
    'case "$*" in',
    "*'\\'*|*'\"'*|*\"'\"*) ;;",
    `*) ${evalBuiltin} eval "$@"; return $? ;;`,
    'esac',
    '__ow_eval_code=$(',
    "{ __ow_sep=''; for __ow_part do printf '%s%s' \"$__ow_sep\" \"$__ow_part\"; __ow_sep=' '; done; printf '\\034'; } | awk " +
      `-v allowAnsi=${syntax.ansi ? 1 : 0} -v allowLocale=${syntax.locale ? 1 : 0} ` +
      quotePosixShellArgument(runtimeEvalRewriter),
    '__ow_rewrite_status=$?',
    'if [ "$__ow_rewrite_status" -ne 0 ]; then exit "$__ow_rewrite_status"; fi',
    "printf '\\034'",
    ') || return $?',
    `__ow_eval_code=\${__ow_eval_code%?}`,
    `${evalBuiltin} eval "$__ow_eval_code"`,
    '}',
  ].join('\n')
}

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
  ...commandOptionCases('trap'),
  'trap) shift; trap "$@" ;;',
  'exec) shift; __ow_mark_export || return $?; command exec "$@" ;;',
  'eval) shift; __ow_eval "$@" ;;',
  '__ow_eval) shift; __ow_eval "$@" ;;',
  '*) command "$@" ;;',
  'esac',
  '}',
  '__ow_builtin() {',
  'case "$1" in',
  'trap) shift; trap "$@" ;;',
  'exec) shift; __ow_mark_export || return $?; builtin exec "$@" ;;',
  'eval) shift; __ow_eval "$@" ;;',
  '__ow_eval) shift; __ow_eval "$@" ;;',
  '*) builtin "$@" ;;',
  'esac',
  '}',
].join('\n')

// Keep the capture EXIT trap private while sourced scripts inspect or replace their own cleanup.
const bashZshUserTraps = [
  '__ow_print_user_exit_trap() {',
  'if [ "$__ow_user_exit_trap_set" -eq 1 ]; then builtin printf \'trap -- %q EXIT\\n\' "$__ow_user_exit_trap"; fi',
  '}',
  '__ow_print_user_traps() {',
  'if [ "$#" -eq 0 ]; then',
  '(builtin trap - EXIT; builtin trap)',
  '__ow_print_user_exit_trap',
  'return',
  'fi',
  'local __ow_signal',
  'for __ow_signal in "$@"; do',
  'case "$__ow_signal" in',
  'EXIT|0) __ow_print_user_exit_trap ;;',
  '*) builtin trap -p "$__ow_signal" ;;',
  'esac',
  'done',
  '}',
  'trap() {',
  'if [ "$#" -eq 0 ]; then __ow_print_user_traps; return; fi',
  'if [ "$1" = \'-p\' ]; then shift; __ow_print_user_traps "$@"; return; fi',
  'if [ "$1" = \'-l\' ]; then builtin trap "$@"; return; fi',
  'if [ "$1" = \'--\' ]; then shift; fi',
  'if [ "$#" -eq 0 ]; then __ow_print_user_traps; return; fi',
  'if [ "$#" -eq 1 ]; then case "$1" in EXIT|0) __ow_user_exit_trap=\'\'; __ow_user_exit_trap_set=0; return ;; *) builtin trap "$@"; return ;; esac; fi',
  'if [ "$#" -lt 2 ]; then builtin trap "$@"; return; fi',
  'local __ow_handler="$1" __ow_signal',
  'shift',
  'for __ow_signal in "$@"; do',
  'case "$__ow_signal" in',
  'EXIT|0) if [ "$__ow_handler" = \'-\' ]; then __ow_user_exit_trap=\'\'; __ow_user_exit_trap_set=0; else __ow_user_exit_trap="$__ow_handler"; __ow_user_exit_trap_set=1; fi ;;',
  '*) builtin trap "$__ow_handler" "$__ow_signal" ;;',
  'esac',
  'done',
  '}',
].join('\n')

function shPrefixedCommand(name: string) {
  // Ksh-style functions preserve temporary assignment export behavior in ksh.
  const functionStart =
    name === 'ksh' || name === 'mksh' ? 'function __ow_command {' : '__ow_command() {'
  return [
    functionStart,
    'case "$1" in',
    ...commandOptionCases('__ow_trap'),
    'trap) shift; __ow_trap "$@" ;;',
    'exec) shift; __ow_mark_export || return $?; command exec "$@" ;;',
    'eval) shift; __ow_eval "$@" ;;',
    '__ow_eval) shift; __ow_eval "$@" ;;',
    '*) command "$@" ;;',
    'esac',
    '}',
  ].join('\n')
}

function fishRuntimeEvalCapture(quote: (value: string) => string) {
  return [
    'function __ow_rewrite_eval',
    'set -l __ow_code (begin',
    "set -l __ow_sep ''",
    'for __ow_part in $argv',
    'printf \'%s%s\' "$__ow_sep" "$__ow_part"',
    "set __ow_sep ' '",
    'end',
    "printf '\\034'",
    `end | command awk ${quote(runtimeFishEvalRewriter)} | string collect -N)`,
    'set -l __ow_pipe_status $pipestatus',
    'if test $__ow_pipe_status[2] -ne 0',
    "printf 'exit %s' $__ow_pipe_status[2]",
    'return',
    'end',
    'printf \'%s\' "$__ow_code"',
    'end',
  ].join('\n')
}

export async function preparationCaptureInvocation(
  invocation: ResolvedActionInvocation,
  destination: string,
  shell: string,
  environment: Readonly<Record<string, string>>,
): Promise<{
  readonly invocation: ResolvedActionInvocation
  readonly format: 'nul' | 'json'
  readonly verifiedPath?: string
}> {
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
  const quotedBuiltinSyntax = await quotedBuiltinSyntaxForShell(shell)
  if (['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(name)) {
    const command = `${resolved.type === 'executable' ? '& ' : ''}${invocationCommand(resolved, quotePowerShellArgument)}`
    const lastUserLine = command.split(/\r\n|\r|\n/u).length + POWERSHELL_SETUP_HEADER_LINES
    const failedExitCode = powerShellFailureExitCode([
      '$__ow_try = $MyInvocation.MyCommand.ScriptBlock.Ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.TryStatementAst] } | Select-Object -Last 1',
      `$__ow_statement = $__ow_try.Body.Statements | Where-Object { $_.Extent.EndLineNumber -le ${lastUserLine} } | Select-Object -Last 1`,
    ])
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
          `$global:LASTEXITCODE = 0\n$__ow_exit = 0\ntry {\n${command}\n$__ow_succeeded = $?\n$__ow_nativeExit = $global:LASTEXITCODE\nif ($__ow_succeeded) { $__ow_exit = 0 } else {\n${failedExitCode}\n}\n} catch {\n$__ow_exit = 1\nthrow\n} finally {\nif ($__ow_exit -eq 0) { $values = @{}; Get-ChildItem Env: | ForEach-Object { $values[$_.Name] = $_.Value }; [System.IO.File]::WriteAllText(${quotePowerShellArgument(destination)}, ($values | ConvertTo-Json -Compress)) }\n}\nexit $__ow_exit`,
        ],
      },
    }
  }
  const script = match(name)
    .with('fish', () => {
      const quote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
      return `umask 077\nfunction __ow_capture --on-event fish_exit\nset -l __ow_exit $status\nif test $__ow_exit -eq 0\ncommand ${POSIX_ENVIRONMENT_DUMP} > ${quote(destination)}\nend\nend\nfunction __ow_capture_exec\ncommand ${POSIX_ENVIRONMENT_DUMP} > ${quote(destination)}; or return $status\nexec $argv\nend\n${fishRuntimeEvalCapture(quote)}\n${captureFishExec(invocationCommand(resolved, quote))}`
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
      const command = posixInvocationCommand(resolved, quotedBuiltinSyntax)
      const enableAliases = name === 'bash' ? 'shopt -s expand_aliases\n' : ''
      return `umask 077\n__ow_user_exit_trap=''\n__ow_user_exit_trap_set=0\n${finish}\nbuiltin trap '__ow_finish "$?"' EXIT\n${bashZshUserTraps}\n${posixCaptureBeforeExec(destination)}\n${posixRuntimeEvalCapture('builtin', quotedBuiltinSyntax)}\n${bashZshPrefixedBuiltins}\n${enableAliases}alias exec='exec $(__ow_capture_exec final)'\nalias command='__ow_command $(__ow_capture_exec)'\nalias builtin='__ow_builtin $(__ow_capture_exec)'\nalias eval='__ow_eval $(__ow_capture_exec)'\neval ${quotePosixShellArgument(command)}\n__ow_finish "$?"`
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
      const command = posixInvocationCommand(resolved, quotedBuiltinSyntax)
      return `umask 077\n__ow_user_exit_trap=''\n${finish}\ncommand trap '__ow_finish "$?"' EXIT\n${userTraps}\n${posixCaptureBeforeExec(destination)}\n${posixRuntimeEvalCapture('command', quotedBuiltinSyntax)}\n${shPrefixedCommand(name)}\nalias trap=__ow_trap\nalias exec='exec $(__ow_capture_exec final)'\nalias command='__ow_command $(__ow_capture_exec)'\nalias eval='__ow_eval $(__ow_capture_exec)'\neval ${quotePosixShellArgument(command)}\n__ow_finish "$?"`
    })
    .otherwise(() => {
      throw new Error(
        `Setup environment capture is not supported by the configured shell: ${shell}.`,
      )
    })
  return {
    format: 'nul',
    verifiedPath: name === 'fish' ? undefined : `${destination}.verified`,
    invocation: {
      type: 'executable',
      cwd: invocation.cwd,
      executable: shell,
      args: ['-c', script],
    },
  }
}
