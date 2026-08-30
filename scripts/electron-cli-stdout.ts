const ANSI_SGR = '\\u001B\\[[0-9;]*m'
const EMPTY_ELECTRON_STDOUT_PREAMBLE = new RegExp(
  `^(?:(?:\\s|${ANSI_SGR})*(?:\\[\\]|\\{\\})(?:\\s|${ANSI_SGR})*)+(?=\\{)`,
  'u',
)

export function applicationCliStdout(
  stdout: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== 'linux') return stdout
  return stdout.replace(EMPTY_ELECTRON_STDOUT_PREAMBLE, '')
}
