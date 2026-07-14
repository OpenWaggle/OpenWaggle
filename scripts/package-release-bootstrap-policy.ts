import {
  ADMIN_REPOSITORY_ROLE_ID,
  isJsonObject,
  MANAGED_RULESET_NAME,
  REPOSITORY,
  REQUIRED_CHECK_CONTEXTS,
  type JsonObject,
} from './package-release-bootstrap-model'

const ALLOWED_MERGE_METHODS = ['squash', 'rebase'] as const
const REQUIRED_RULE_TYPES = [
  'deletion',
  'non_fast_forward',
  'pull_request',
  'required_status_checks',
] as const

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function stringArray(value: unknown) {
  return isUnknownArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined
}

function hasMainOnlyCondition(value: JsonObject) {
  const conditions = value.conditions
  const refName = isJsonObject(conditions) ? conditions.ref_name : undefined
  if (!isJsonObject(refName)) return false
  const includes = stringArray(refName.include)
  const excludes = stringArray(refName.exclude)
  return includes?.length === 1 && includes[0] === 'refs/heads/main' && excludes?.length === 0
}

function hasAdminBypass(value: JsonObject) {
  const bypassActors = value.bypass_actors
  return (
    isUnknownArray(bypassActors) &&
    bypassActors.length === 1 &&
    isJsonObject(bypassActors[0]) &&
    bypassActors[0].actor_id === ADMIN_REPOSITORY_ROLE_ID &&
    bypassActors[0].actor_type === 'RepositoryRole' &&
    bypassActors[0].bypass_mode === 'always'
  )
}

function hasCoreRules(value: JsonObject) {
  if (!isUnknownArray(value.rules) || value.rules.length !== REQUIRED_RULE_TYPES.length) {
    return false
  }
  const types = value.rules.flatMap((rule) =>
    isJsonObject(rule) && typeof rule.type === 'string' ? [rule.type] : [],
  )
  return (
    types.length === REQUIRED_RULE_TYPES.length &&
    REQUIRED_RULE_TYPES.every((type) => types.includes(type))
  )
}

function findRule(rules: unknown, type: string) {
  if (!isUnknownArray(rules)) return undefined
  return rules.find((rule) => isJsonObject(rule) && rule.type === type)
}

function hasExactStatusChecks(value: JsonObject) {
  const statusRule = findRule(value.rules, 'required_status_checks')
  if (!isJsonObject(statusRule) || !isJsonObject(statusRule.parameters)) return false
  const checks = statusRule.parameters.required_status_checks
  if (!isUnknownArray(checks) || checks.length !== REQUIRED_CHECK_CONTEXTS.length) return false
  const contexts = checks.flatMap((check) =>
    isJsonObject(check) &&
    typeof check.context === 'string' &&
    (check.integration_id === undefined || check.integration_id === null)
      ? [check.context]
      : [],
  )
  return (
    statusRule.parameters.do_not_enforce_on_create === true &&
    statusRule.parameters.strict_required_status_checks_policy === true &&
    contexts.length === REQUIRED_CHECK_CONTEXTS.length &&
    REQUIRED_CHECK_CONTEXTS.every((context) => contexts.includes(context))
  )
}

function hasRequiredPullRequests(value: JsonObject) {
  const pullRequestRule = findRule(value.rules, 'pull_request')
  if (!isJsonObject(pullRequestRule) || !isJsonObject(pullRequestRule.parameters)) return false
  const parameters = pullRequestRule.parameters
  const mergeMethods = stringArray(parameters.allowed_merge_methods)
  return (
    mergeMethods?.length === ALLOWED_MERGE_METHODS.length &&
    ALLOWED_MERGE_METHODS.every((method) => mergeMethods.includes(method)) &&
    parameters.dismiss_stale_reviews_on_push === false &&
    parameters.require_code_owner_review === false &&
    parameters.require_last_push_approval === false &&
    parameters.required_approving_review_count === 0 &&
    parameters.required_review_thread_resolution === true
  )
}

export function isCompatibleRuleset(value: unknown) {
  if (!isJsonObject(value)) return false
  if (
    value.name !== MANAGED_RULESET_NAME ||
    value.target !== 'branch' ||
    value.enforcement !== 'active' ||
    value.source_type !== 'Repository' ||
    value.source !== REPOSITORY
  ) {
    return false
  }
  return (
    hasMainOnlyCondition(value) &&
    hasAdminBypass(value) &&
    hasCoreRules(value) &&
    hasRequiredPullRequests(value) &&
    hasExactStatusChecks(value)
  )
}

export function isCompatibleRepositoryMergePolicy(value: unknown) {
  return (
    isJsonObject(value) &&
    value.allow_merge_commit === false &&
    value.allow_rebase_merge === true &&
    value.allow_squash_merge === true
  )
}

export function isCompatibleEnvironment(value: unknown) {
  if (!isJsonObject(value) || !isJsonObject(value.deployment_branch_policy)) return false
  const policy = value.deployment_branch_policy
  if (policy.protected_branches !== false || policy.custom_branch_policies !== true) return false
  const protectionRules = value.protection_rules
  return (
    isUnknownArray(protectionRules) &&
    protectionRules.length <= 1 &&
    protectionRules.every((rule) => isJsonObject(rule) && rule.type === 'branch_policy')
  )
}

export function hasExpectedBranchProtectionRules(value: unknown, count: number) {
  return (
    isJsonObject(value) &&
    isUnknownArray(value.protection_rules) &&
    value.protection_rules.length === count
  )
}

export function hasMainOnlyBranchPolicy(value: unknown) {
  if (!isJsonObject(value) || !isUnknownArray(value.branch_policies)) return false
  return (
    value.branch_policies.length === 1 &&
    isJsonObject(value.branch_policies[0]) &&
    value.branch_policies[0].name === 'main' &&
    value.branch_policies[0].type === 'branch'
  )
}

export function hasNoBranchPolicies(value: unknown) {
  return (
    isJsonObject(value) &&
    isUnknownArray(value.branch_policies) &&
    value.branch_policies.length === 0
  )
}

export function hasNoSecrets(value: unknown) {
  if (!isJsonObject(value) || !isUnknownArray(value.secrets)) return false
  return value.secrets.length === 0 && value.total_count === 0
}
