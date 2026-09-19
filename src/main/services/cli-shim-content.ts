import type { CliShimServiceInput } from './cli-shim-service'

export const MANAGED_CLI_SHIM_MARKER =
  '# Managed by OpenWaggle. Configure from Settings > Agent access.'

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function linuxManagedCliShimContent(command: string) {
  return `#!/bin/sh
${MANAGED_CLI_SHIM_MARKER}
exec env OPENWAGGLE_CLI_OUTPUT_FD=3 ${command} "$@" 3>&1 1>/dev/null
`
}

export function managedCliShimContent(input: CliShimServiceInput) {
  const arguments_ = input.appPath ? ` ${shellQuote(input.appPath)}` : ''
  const command = `${shellQuote(input.executablePath)}${arguments_}`
  return input.platform === 'linux'
    ? linuxManagedCliShimContent(command)
    : `#!/bin/sh\n${MANAGED_CLI_SHIM_MARKER}\nexec ${command} "$@"\n`
}
