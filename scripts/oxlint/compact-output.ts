/**
 * Turns the `unix` report that both lint runners print (`file:line:col: message [Error/rule]`)
 * into one `file:line:col rule [ID] message` line per finding, and drops the trailing problem
 * count. `[ID]` is the rule catalogue ID (.agents/rules.json) the lint rule enforces, when it has
 * one. A line that is not a finding, such as a crash or a config error, is kept as it is.
 */
import path from 'node:path'
import { lintRuleIds, readRuleCatalogue } from '../support/rule-catalogue'

const UNIX_FINDING =
  /^(?<location>.+?:\d+:\d+): (?<message>.*) \[(?:Error|Warning)(?:\/(?<rule>[^\]]+))?\]$/u
const PROBLEM_COUNT = /^\d+ problems?$/u

function compactRuleName(rule: string) {
  // `eslint(no-debugger)` and `openwaggle(no-for-each)` read as `no-debugger` and
  // `openwaggle/no-for-each`, the names the config uses.
  const match = /^(?<plugin>[^(]+)\((?<name>[^)]+)\)$/u.exec(rule)
  if (!match?.groups) return rule
  const { plugin, name } = match.groups
  return plugin === 'eslint' ? name : `${plugin}/${name}`
}

let repositoryRuleIds: ReadonlyMap<string, string> | undefined

function defaultRuleIds() {
  repositoryRuleIds ??= lintRuleIds(readRuleCatalogue(path.join(import.meta.dirname, '..', '..')))
  return repositoryRuleIds
}

export function compactLintOutput(
  output: string,
  ruleIds: ReadonlyMap<string, string> = defaultRuleIds(),
) {
  const lines: string[] = []
  for (const line of output.split(/\r?\n/u)) {
    if (line.trim() === '' || PROBLEM_COUNT.test(line)) continue
    const groups = UNIX_FINDING.exec(line)?.groups
    if (!groups) {
      lines.push(line)
      continue
    }
    const rule = groups.rule === undefined ? 'lint' : compactRuleName(groups.rule)
    const id = ruleIds.get(rule)
    lines.push(`${groups.location} ${rule}${id === undefined ? '' : ` [${id}]`} ${groups.message}`)
  }
  return lines
}
