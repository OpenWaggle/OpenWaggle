const EMPTY_ELECTRON_STDOUT_PREAMBLE = /^(?:\s*(?:\[\]|\{\})\s*)+(?=\{)/u
const OPENWAGGLE_JSON_RESPONSE_START = /\{\s*"schemaVersion"\s*:/u

export function applicationCliStdout(
  stdout: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== 'linux') return stdout
  const withoutEmptyPreamble = stdout.replace(EMPTY_ELECTRON_STDOUT_PREAMBLE, '')
  const responseStart = withoutEmptyPreamble.search(OPENWAGGLE_JSON_RESPONSE_START)
  return responseStart > 0 ? withoutEmptyPreamble.slice(responseStart) : withoutEmptyPreamble
}
