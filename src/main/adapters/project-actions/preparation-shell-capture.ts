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
          `$global:LASTEXITCODE = 0\ntry {\n${command}\nif (-not $?) { $global:LASTEXITCODE = 1 }\n} finally {\nif ($global:LASTEXITCODE -eq 0) { $values = @{}; Get-ChildItem Env: | ForEach-Object { $values[$_.Name] = $_.Value }; [System.IO.File]::WriteAllText(${quotePowerShellArgument(destination)}, ($values | ConvertTo-Json -Compress)) }\n}\nexit $global:LASTEXITCODE`,
        ],
      },
    }
  }
  const script = match(name)
    .with('fish', () => {
      const quote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
      return `umask 077\nfunction __ow_capture --on-event fish_exit\nset -l __ow_exit $status\nif test $__ow_exit -eq 0\ncommand ${POSIX_ENVIRONMENT_DUMP} > ${quote(destination)}\nend\nend\n${invocationCommand(resolved, quote)}`
    })
    .with('sh', 'bash', 'dash', 'zsh', 'ksh', 'mksh', () => {
      // EXIT also handles an explicit successful exit in the user's setup command.
      const capture = `__ow_exit=$?; if [ "$__ow_exit" -eq 0 ]; then ${POSIX_ENVIRONMENT_DUMP} > ${quotePosixShellArgument(destination)} || __ow_exit=$?; fi; exit "$__ow_exit"`
      return `umask 077\ntrap ${quotePosixShellArgument(capture)} EXIT\n${invocationCommand(resolved, quotePosixShellArgument)}`
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
