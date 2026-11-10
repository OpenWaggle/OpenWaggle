/**
 * Reads the rule catalogue, `.agents/rules.json`: the stable rule IDs that `.agents/standards.md`,
 * lint output, the agent gate and reviews cite. Each rule lists what enforces it in `by`; a lint
 * rule name there maps lint findings to the rule's ID.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const RULE_CATALOGUE_FILE = '.agents/rules.json'
export const RULE_ID = /^(?:TS|ARCH|PKG|PI|SHELL|REACT|TEST|TOOL|DEP|GIT|GATE|DOC)-\d{2}$/u
/** A citation of a rule ID in prose or output, such as `[TS-02]`. */
export const RULE_CITATION =
  /\[(?<id>(?:TS|ARCH|PKG|PI|SHELL|REACT|TEST|TOOL|DEP|GIT|GATE|DOC)-\d{2})\]/gu

export interface CatalogueRule {
  readonly id: string
  readonly rule: string
  readonly by: readonly string[]
  readonly retired: boolean
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** The catalogue's rules, or a list of problems when the file does not have the expected shape. */
export function parseRuleCatalogue(
  text: string,
): { readonly rules: readonly CatalogueRule[] } | { readonly problems: readonly string[] } {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    return {
      problems: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
  const rules = isRecord(document) ? document['rules'] : undefined
  if (!isRecord(rules)) return { problems: ['expected an object with a "rules" object'] }
  const problems: string[] = []
  const parsed: CatalogueRule[] = []
  for (const [id, entry] of Object.entries(rules)) {
    const rule = isRecord(entry) ? entry['rule'] : undefined
    const by = isRecord(entry) ? entry['by'] : undefined
    const retired = isRecord(entry) ? entry['retired'] : undefined
    if (!RULE_ID.test(id)) problems.push(`${id}: IDs look like TS-01 with a known prefix`)
    if (typeof rule !== 'string' || rule.trim() === '') problems.push(`${id}: "rule" is empty`)
    if (!isStringList(by) || by.length === 0) problems.push(`${id}: "by" lists what enforces it`)
    if (retired !== undefined && typeof retired !== 'boolean') {
      problems.push(`${id}: "retired" is a boolean`)
    }
    parsed.push({
      id,
      rule: typeof rule === 'string' ? rule : '',
      by: isStringList(by) ? by : [],
      retired: retired === true,
    })
  }
  return problems.length > 0 ? { problems } : { rules: parsed }
}

/** Lint rule name (`typescript/no-explicit-any`, `complexity`) to the ID of the rule it enforces. */
export function lintRuleIds(rules: readonly CatalogueRule[]): ReadonlyMap<string, string> {
  const ids = new Map<string, string>()
  for (const rule of rules) {
    for (const enforcer of rule.by) {
      if (!enforcer.includes(':') && !ids.has(enforcer)) ids.set(enforcer, rule.id)
    }
  }
  return ids
}

/** The catalogue at `root`, or an empty list when it is missing or malformed (the check reports it). */
export function readRuleCatalogue(root: string): readonly CatalogueRule[] {
  try {
    const parsed = parseRuleCatalogue(readFileSync(path.join(root, RULE_CATALOGUE_FILE), 'utf8'))
    return 'rules' in parsed ? parsed.rules : []
  } catch {
    return []
  }
}
