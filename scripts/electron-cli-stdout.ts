const EMPTY_ELECTRON_STDOUT_PREAMBLE = /^(?:\s*(?:\[\]|\{\})\s*)+(?=\{)/u

export function applicationCliStdout(
  stdout: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== 'linux') return stdout
  return stdout.replace(EMPTY_ELECTRON_STDOUT_PREAMBLE, '')
}
