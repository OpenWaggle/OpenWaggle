import { Schema } from '@shared/schema'
import {
  ADMIN_REPOSITORY_ROLE_ID,
  DEPLOYED_LEGACY_CHECK_CONTEXTS,
  MANAGED_RULESET_NAME,
  REPOSITORY,
  REQUIRED_CHECK_CONTEXTS,
} from './package-release-bootstrap-model'

const ALLOWED_MERGE_METHODS = ['squash', 'rebase'] as const
const REQUIRED_RULE_TYPES = [
  'deletion',
  'non_fast_forward',
  'pull_request',
  'required_status_checks',
] as const

/** A GitHub ruleset rule: its `type` and, for the rules this policy reads, its `parameters`. */
const rulesetRuleSchema = Schema.Struct({
  type: Schema.String,
  parameters: Schema.optional(Schema.Unknown),
})

/** The managed ruleset fields both ruleset predicates require, before the status checks. */
const managedRulesetSchema = Schema.Struct({
  name: Schema.Literal(MANAGED_RULESET_NAME),
  target: Schema.Literal('branch'),
  enforcement: Schema.Literal('active'),
  source_type: Schema.Literal('Repository'),
  source: Schema.Literal(REPOSITORY),
  conditions: Schema.Struct({
    ref_name: Schema.Struct({
      include: Schema.Tuple(Schema.Literal('refs/heads/main')),
      exclude: Schema.Tuple(),
    }),
  }),
  bypass_actors: Schema.Tuple(
    Schema.Struct({
      actor_id: Schema.Literal(ADMIN_REPOSITORY_ROLE_ID),
      actor_type: Schema.Literal('RepositoryRole'),
      bypass_mode: Schema.Literal('always'),
    }),
  ),
  rules: Schema.Array(rulesetRuleSchema),
})
type ManagedRuleset = Schema.Schema.Type<typeof managedRulesetSchema>

const pullRequestParametersSchema = Schema.Struct({
  allowed_merge_methods: Schema.Array(Schema.String),
  dismiss_stale_reviews_on_push: Schema.Literal(false),
  require_extra_approval_for_unattributed_changes: Schema.Literal(true),
  require_code_owner_review: Schema.Literal(false),
  require_last_push_approval: Schema.Literal(false),
  required_approving_review_count: Schema.Literal(0),
  required_review_thread_resolution: Schema.Literal(true),
})

const statusCheckParametersSchema = Schema.Struct({
  do_not_enforce_on_create: Schema.Literal(true),
  strict_required_status_checks_policy: Schema.Literal(true),
  required_status_checks: Schema.Array(Schema.Unknown),
})

/** A required status check that names a context and no integration. */
const contextOnlyStatusCheckSchema = Schema.Struct({
  context: Schema.String,
  integration_id: Schema.optional(Schema.Null),
})

const repositoryMergePolicySchema = Schema.Struct({
  allow_merge_commit: Schema.Literal(false),
  allow_rebase_merge: Schema.Literal(true),
  allow_squash_merge: Schema.Literal(true),
})

const environmentSchema = Schema.Struct({
  deployment_branch_policy: Schema.Struct({
    protected_branches: Schema.Literal(false),
    custom_branch_policies: Schema.Literal(true),
  }),
  protection_rules: Schema.Array(Schema.Unknown),
})

const protectionRulesSchema = Schema.Struct({ protection_rules: Schema.Array(Schema.Unknown) })
const branchPolicyRuleSchema = Schema.Struct({ type: Schema.Literal('branch_policy') })
const branchPoliciesSchema = Schema.Struct({ branch_policies: Schema.Array(Schema.Unknown) })
const mainBranchPolicySchema = Schema.Struct({
  name: Schema.Literal('main'),
  type: Schema.Literal('branch'),
})
const noSecretsSchema = Schema.Struct({
  secrets: Schema.Tuple(),
  total_count: Schema.Literal(0),
})

const isManagedRuleset = Schema.is(managedRulesetSchema)
const isPullRequestParameters = Schema.is(pullRequestParametersSchema)
const isStatusCheckParameters = Schema.is(statusCheckParametersSchema)
const isContextOnlyStatusCheck = Schema.is(contextOnlyStatusCheckSchema)
const isBranchPolicyRule = Schema.is(branchPolicyRuleSchema)
const isMainBranchPolicy = Schema.is(mainBranchPolicySchema)

function hasCoreRules(ruleset: ManagedRuleset) {
  const types = ruleset.rules.map((rule) => rule.type)
  return (
    types.length === REQUIRED_RULE_TYPES.length &&
    REQUIRED_RULE_TYPES.every((type) => types.includes(type))
  )
}

function ruleParameters(ruleset: ManagedRuleset, type: string) {
  return ruleset.rules.find((rule) => rule.type === type)?.parameters
}

function hasStatusChecks(ruleset: ManagedRuleset, expected: readonly string[]) {
  const parameters = ruleParameters(ruleset, 'required_status_checks')
  if (!isStatusCheckParameters(parameters)) return false
  const checks = parameters.required_status_checks
  if (checks.length !== expected.length) return false
  const contexts = checks.flatMap((check) =>
    isContextOnlyStatusCheck(check) ? [check.context] : [],
  )
  return (
    contexts.length === expected.length && expected.every((context) => contexts.includes(context))
  )
}

function hasRequiredPullRequests(ruleset: ManagedRuleset) {
  const parameters = ruleParameters(ruleset, 'pull_request')
  if (!isPullRequestParameters(parameters)) return false
  const mergeMethods = parameters.allowed_merge_methods
  return (
    mergeMethods.length === ALLOWED_MERGE_METHODS.length &&
    ALLOWED_MERGE_METHODS.every((method) => mergeMethods.includes(method))
  )
}

function hasManagedRulesetShape(value: unknown): value is ManagedRuleset {
  return isManagedRuleset(value) && hasCoreRules(value) && hasRequiredPullRequests(value)
}

export function isCompatibleRuleset(value: unknown) {
  return hasManagedRulesetShape(value) && hasStatusChecks(value, REQUIRED_CHECK_CONTEXTS)
}

export function isRulesetMissingRequiredChecks(value: unknown) {
  return hasManagedRulesetShape(value) && hasStatusChecks(value, DEPLOYED_LEGACY_CHECK_CONTEXTS)
}

export const isCompatibleRepositoryMergePolicy = Schema.is(repositoryMergePolicySchema)

export function isCompatibleEnvironment(value: unknown) {
  return (
    Schema.is(environmentSchema)(value) &&
    value.protection_rules.length <= 1 &&
    value.protection_rules.every(isBranchPolicyRule)
  )
}

export function hasExpectedBranchProtectionRules(value: unknown, count: number) {
  return Schema.is(protectionRulesSchema)(value) && value.protection_rules.length === count
}

export function hasMainOnlyBranchPolicy(value: unknown) {
  if (!Schema.is(branchPoliciesSchema)(value)) return false
  const [first, ...rest] = value.branch_policies
  return rest.length === 0 && isMainBranchPolicy(first)
}

export function hasNoBranchPolicies(value: unknown) {
  return Schema.is(branchPoliciesSchema)(value) && value.branch_policies.length === 0
}

export const hasNoSecrets = Schema.is(noSecretsSchema)
