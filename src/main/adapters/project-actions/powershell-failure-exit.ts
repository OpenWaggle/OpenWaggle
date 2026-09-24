/** Preserve a final native failure without reusing LASTEXITCODE from an earlier statement. */
export function powerShellFailureExitCode(statementDiscovery: readonly string[]) {
  return [
    ...statementDiscovery,
    '$__ow_exit = 1',
    'if ($__ow_statement -is [System.Management.Automation.Language.PipelineAst]) {',
    '  $__ow_last = $__ow_statement.PipelineElements[-1]',
    '  if ($__ow_last -is [System.Management.Automation.Language.CommandAst]) {',
    '    $__ow_name = $__ow_last.GetCommandName()',
    '    if (!$__ow_name -and $__ow_last.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Ampersand) {',
    '      $__ow_first = $__ow_last.CommandElements[0]',
    '      if ($__ow_first -is [System.Management.Automation.Language.VariableExpressionAst]) {',
    '        $__ow_name = Get-Variable -Name $__ow_first.VariablePath.UserPath -ValueOnly -ErrorAction SilentlyContinue',
    '      }',
    '    }',
    '    if ($__ow_name) {',
    '      $__ow_info = Get-Command -Name $__ow_name -ErrorAction SilentlyContinue | Select-Object -First 1',
    '      while ($__ow_info -is [System.Management.Automation.AliasInfo]) { $__ow_info = $__ow_info.ResolvedCommand }',
    '      if ($__ow_info -and $__ow_info.CommandType -eq [System.Management.Automation.CommandTypes]::Application -and $__ow_nativeExit -ne 0) { $__ow_exit = $__ow_nativeExit }',
    '    }',
    '  }',
    '}',
  ].join('\n')
}
