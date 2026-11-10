import { countO200kTokens } from '../perf/first-turn-prefix/prefix-tokens'
import {
  RULE_CATALOGUE_FILE,
  RULE_CITATION,
  type CatalogueRule,
  parseRuleCatalogue,
} from '../support/rule-catalogue'
import type { Violation } from './violation'

/**
 * The rule catalogue (`.agents/rules.json`) is the one list of rule IDs. Agents load it, so it has
 * a token cap like project memory. Every live ID is cited in `.agents/standards.md`, every ID cited
 * in agent instructions, the lint plugin or the agent gate exists, and every OpenWaggle lint rule
 * names the ID it enforces in some rule's `by` list.
 */
export const RULE_CATALOGUE_TOKEN_CAP = 3_500
const STANDARDS_FILE = '.agents/standards.md'
const LINT_PLUGIN_FILE = 'scripts/oxlint/openwaggle-plugin.ts'
const CITING_FILES =
  /^(?:AGENTS\.md|DEPENDENCIES\.md|\.agents\/|scripts\/agent-gate\/|scripts\/oxlint\/)/u
const PLUGIN_RULE_KEY = /^\s*'(?<name>[a-z][a-z-]*)': [A-Za-z]+Rule,$/gmu
const CATALOGUE_KEY = /^\s*"(?<id>[A-Z]+-\d+)":/gmu
const ENFORCER_KINDS =
  /^(?:gate|standards|check):[a-z][a-z-]*$|^(?:review|fallow|react-doctor)$|^[@a-z]/u

function duplicateIds(text: string) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const match of text.matchAll(CATALOGUE_KEY)) {
    const id = match.groups?.['id'] ?? ''
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates]
}

function citations(text: string) {
  return new Set([...text.matchAll(RULE_CITATION)].flatMap((match) => match.groups?.['id'] ?? []))
}

function enforcementViolations(rules: readonly CatalogueRule[], gateChecks: ReadonlySet<string>) {
  return rules.flatMap((rule) =>
    rule.by.flatMap((enforcer) => {
      const gateCheck = enforcer.startsWith('gate:') ? enforcer.slice('gate:'.length) : undefined
      const valid =
        ENFORCER_KINDS.test(enforcer) && (gateCheck === undefined || gateChecks.has(gateCheck))
      return valid
        ? []
        : [
            {
              file: RULE_CATALOGUE_FILE,
              detail: `${rule.id}: ${enforcer}`,
              message: 'Unknown enforcer in "by".',
            },
          ]
    }),
  )
}

function pluginRuleViolations(rules: readonly CatalogueRule[], plugin: string | undefined) {
  if (plugin === undefined) return []
  const enforced = new Set(rules.flatMap((rule) => rule.by))
  return [...plugin.matchAll(PLUGIN_RULE_KEY)]
    .flatMap((match) => match.groups?.['name'] ?? [])
    .filter((name) => !enforced.has(`openwaggle/${name}`))
    .map((name) => ({
      file: RULE_CATALOGUE_FILE,
      detail: `openwaggle/${name}`,
      message: 'Name this lint rule in the "by" list of the rule it enforces.',
    }))
}

function citationViolations(
  rules: readonly CatalogueRule[],
  contentsByFile: ReadonlyMap<string, string>,
): Violation[] {
  const live = new Set(rules.filter((rule) => !rule.retired).map((rule) => rule.id))
  const documented = citations(contentsByFile.get(STANDARDS_FILE) ?? '')
  const undocumented = [...live]
    .filter((id) => !documented.has(id))
    .map((id) => ({
      file: STANDARDS_FILE,
      detail: id,
      message: 'Cite every live rule ID as [ID].',
    }))
  const unknown = [...contentsByFile]
    .filter(([file]) => CITING_FILES.test(file))
    .flatMap(([file, text]) =>
      [...citations(text)]
        .filter((id) => !live.has(id))
        .map((id) => ({
          file,
          detail: id,
          message: `Cites a rule ID that ${RULE_CATALOGUE_FILE} does not define.`,
        })),
    )
  return [...undocumented, ...unknown]
}

export function collectRuleCatalogueViolations(
  contentsByFile: ReadonlyMap<string, string>,
  gateChecks: ReadonlySet<string>,
): Violation[] {
  const text = contentsByFile.get(RULE_CATALOGUE_FILE)
  if (text === undefined) {
    return [{ file: RULE_CATALOGUE_FILE, message: 'The rule catalogue is missing.' }]
  }
  const parsed = parseRuleCatalogue(text)
  if ('problems' in parsed) {
    return parsed.problems.map((detail) => ({
      file: RULE_CATALOGUE_FILE,
      detail,
      message: 'The rule catalogue is malformed.',
    }))
  }
  const tokens = countO200kTokens(text)
  return [
    ...duplicateIds(text).map((id) => ({
      file: RULE_CATALOGUE_FILE,
      detail: id,
      message: 'Rule IDs are unique.',
    })),
    ...(tokens > RULE_CATALOGUE_TOKEN_CAP
      ? [
          {
            file: RULE_CATALOGUE_FILE,
            detail: `${tokens} > ${RULE_CATALOGUE_TOKEN_CAP} o200k tokens`,
            message: 'Agents load the catalogue; shorten rule text instead of raising the cap.',
          },
        ]
      : []),
    ...enforcementViolations(parsed.rules, gateChecks),
    ...pluginRuleViolations(parsed.rules, contentsByFile.get(LINT_PLUGIN_FILE)),
    ...citationViolations(parsed.rules, contentsByFile),
  ]
}
