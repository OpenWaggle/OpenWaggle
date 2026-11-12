/**
 * Turns the `unix` report that both lint runners print (`file:line:col: message [Error/rule]`)
 * into one `file:line:col rule message` line per finding, and drops the trailing problem count.
 * The rule name is the one oxlint.config.mts uses, so a finding names the rule's documentation.
 * A line that is not a finding, such as a crash or a config error, is kept as it is.
 */
const UNIX_FINDING =
  /^(?<location>.+?:\d+:\d+): (?<message>.*) \[(?:Error|Warning)(?:\/(?<rule>[^\]]+))?\]$/u
const PROBLEM_COUNT = /^\d+ problems?$/u

function compactRuleName(rule: string) {
  // `eslint(no-debugger)` and `openwaggle(no-for-each)` read as `no-debugger` and
  // `openwaggle/no-for-each`, the names the config uses.
  const match = /^(?<plugin>[^(]+)\((?<name>[^)]+)\)$/u.exec(rule)
  const plugin = match?.groups?.['plugin']
  const name = match?.groups?.['name']
  if (plugin === undefined || name === undefined) return rule
  return plugin === 'eslint' ? name : `${plugin}/${name}`
}

export function compactLintOutput(output: string) {
  const lines: string[] = []
  for (const line of output.split(/\r?\n/u)) {
    if (line.trim() === '' || PROBLEM_COUNT.test(line)) continue
    const groups = UNIX_FINDING.exec(line)?.groups
    if (!groups) {
      lines.push(line)
      continue
    }
    const rule = groups['rule'] === undefined ? 'lint' : compactRuleName(groups['rule'])
    lines.push(`${groups['location']} ${rule} ${groups['message']}`)
  }
  return lines
}
