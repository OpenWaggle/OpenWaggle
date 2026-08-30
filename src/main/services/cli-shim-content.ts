import type { CliShimServiceInput } from './cli-shim-service'

export const MANAGED_CLI_SHIM_MARKER =
  '# Managed by OpenWaggle. Configure from Settings > Agent access.'

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export function managedCliShimContent(input: CliShimServiceInput) {
  const arguments_ = input.appPath ? ` ${shellQuote(input.appPath)}` : ''
  return `#!/bin/sh\n${MANAGED_CLI_SHIM_MARKER}\nexec ${shellQuote(input.executablePath)}${arguments_} "$@"\n`
}
