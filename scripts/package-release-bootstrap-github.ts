import {
  isNotFound,
  redactBootstrapDiagnostic,
  runCommand,
  runMutation,
  runRequired,
} from './package-release-bootstrap-commands'
import {
  createEnvironmentPayload,
  createRepositoryMergePolicyPayload,
  createRulesetPayload,
  isJsonObject,
  MANAGED_RULESET_NAME,
  parseJson,
  parseJsonObject,
} from './package-release-bootstrap-model'
import {
  hasExpectedBranchProtectionRules,
  hasMainOnlyBranchPolicy,
  hasNoBranchPolicies,
  hasNoSecrets,
  isCompatibleEnvironment,
  isCompatibleRepositoryMergePolicy,
  isCompatibleRuleset,
} from './package-release-bootstrap-policy'
import type {
  BootstrapDependencies,
  BootstrapGithubProgress,
} from './package-release-bootstrap-types'

const ENVIRONMENT_ENDPOINT = 'repos/OpenWaggle/OpenWaggle/environments/npm'
const BRANCH_POLICIES_ENDPOINT = `${ENVIRONMENT_ENDPOINT}/deployment-branch-policies`
const BRANCH_POLICIES_LIST_ENDPOINT = `${BRANCH_POLICIES_ENDPOINT}?per_page=2`
const SECRETS_ENDPOINT = `${ENVIRONMENT_ENDPOINT}/secrets`
const SECRETS_LIST_ENDPOINT = `${SECRETS_ENDPOINT}?per_page=1`
const RULESETS_ENDPOINT = 'repos/OpenWaggle/OpenWaggle/rulesets'
const RULESETS_LIST_ENDPOINT = `${RULESETS_ENDPOINT}?includes_parents=false&per_page=100`
const REPOSITORY_ENDPOINT = 'repos/OpenWaggle/OpenWaggle'
const GH_API_ARGS = ['api', '--hostname', 'github.com'] as const

function flattenRulesetPages(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('GitHub repository ruleset pages must return a JSON array.')
  }
  const rulesets: unknown[] = []
  for (const page of value) {
    if (!Array.isArray(page)) {
      throw new Error('Each GitHub repository ruleset page must be a JSON array.')
    }
    for (const ruleset of page) rulesets.push(ruleset)
  }
  return rulesets
}

async function inspectExistingEnvironment(
  projectRoot: string,
  dependencies: BootstrapDependencies,
  environmentOutput: string,
) {
  const environment = parseJson(environmentOutput, 'GitHub npm environment')
  const branchPolicies = parseJson(
    await runRequired(dependencies, {
      args: [...GH_API_ARGS, BRANCH_POLICIES_LIST_ENDPOINT],
      command: 'gh',
      cwd: projectRoot,
    }),
    'GitHub npm environment branch policies',
  )
  const secrets = parseJson(
    await runRequired(dependencies, {
      args: [...GH_API_ARGS, SECRETS_LIST_ENDPOINT],
      command: 'gh',
      cwd: projectRoot,
    }),
    'GitHub npm environment secrets',
  )
  if (!isCompatibleEnvironment(environment) || !hasNoSecrets(secrets)) return 'conflict'
  if (
    hasMainOnlyBranchPolicy(branchPolicies) &&
    hasExpectedBranchProtectionRules(environment, 1)
  ) {
    return 'compatible'
  }
  if (
    hasNoBranchPolicies(branchPolicies) &&
    hasExpectedBranchProtectionRules(environment, 0)
  ) {
    return 'pending'
  }
  return 'conflict'
}

async function inspectEnvironment(
  projectRoot: string,
  dependencies: BootstrapDependencies,
): Promise<BootstrapGithubProgress['environment']> {
  const result = await runCommand(dependencies, {
    args: [...GH_API_ARGS, ENVIRONMENT_ENDPOINT],
    command: 'gh',
    cwd: projectRoot,
  })
  if (isNotFound(result)) return 'pending'
  if (result.exitCode === 0) {
    return inspectExistingEnvironment(projectRoot, dependencies, result.stdout)
  }
  throw new Error(
    `gh api ${ENVIRONMENT_ENDPOINT} failed: ${redactBootstrapDiagnostic(result.stderr)}`,
  )
}

async function inspectRuleset(
  projectRoot: string,
  dependencies: BootstrapDependencies,
): Promise<BootstrapGithubProgress['ruleset']> {
  const rulesets = flattenRulesetPages(parseJson(
    await runRequired(dependencies, {
      args: [...GH_API_ARGS, RULESETS_LIST_ENDPOINT, '--paginate', '--slurp'],
      command: 'gh',
      cwd: projectRoot,
    }),
    'GitHub repository rulesets',
  ))
  const managed = rulesets.filter(
    (ruleset) => isJsonObject(ruleset) && ruleset.name === MANAGED_RULESET_NAME,
  )
  if (managed.length === 0) return 'pending'
  if (managed.length !== 1) return 'conflict'
  const summary: unknown = managed[0]
  if (!isJsonObject(summary) || typeof summary.id !== 'number') return 'conflict'
  const ruleset = parseJson(
    await runRequired(dependencies, {
      args: [...GH_API_ARGS, `${RULESETS_ENDPOINT}/${String(summary.id)}`],
      command: 'gh',
      cwd: projectRoot,
    }),
    'GitHub managed ruleset',
  )
  return isCompatibleRuleset(ruleset) ? 'compatible' : 'conflict'
}

async function inspectRepositoryMergePolicy(
  projectRoot: string,
  dependencies: BootstrapDependencies,
) {
  const repository = parseJson(
    await runRequired(dependencies, {
      args: [...GH_API_ARGS, REPOSITORY_ENDPOINT],
      command: 'gh',
      cwd: projectRoot,
    }),
    'GitHub repository settings',
  )
  return isCompatibleRepositoryMergePolicy(repository) ? 'compatible' : 'pending'
}

export async function inspectGithubState(
  projectRoot: string,
  dependencies: BootstrapDependencies,
): Promise<BootstrapGithubProgress> {
  const ruleset = await inspectRuleset(projectRoot, dependencies)
  const repositoryMergePolicy = await inspectRepositoryMergePolicy(projectRoot, dependencies)
  return {
    environment: await inspectEnvironment(projectRoot, dependencies),
    ruleset:
      ruleset === 'conflict'
        ? 'conflict'
        : ruleset === 'pending' || repositoryMergePolicy === 'pending'
          ? 'pending'
          : 'compatible',
  }
}

export async function createAndVerifyGithubEnvironment(
  projectRoot: string,
  dependencies: BootstrapDependencies,
) {
  dependencies.writeLine('[github] create npm environment with main-only deployments')
  await runMutation(dependencies, {
    args: [...GH_API_ARGS, '--method', 'PUT', ENVIRONMENT_ENDPOINT, '--input', '-'],
    command: 'gh',
    cwd: projectRoot,
    input: JSON.stringify(createEnvironmentPayload()),
  })
  await runMutation(dependencies, {
    args: [...GH_API_ARGS, '--method', 'POST', BRANCH_POLICIES_ENDPOINT, '--input', '-'],
    command: 'gh',
    cwd: projectRoot,
    input: JSON.stringify({ name: 'main', type: 'branch' }),
  })
  const state = await inspectExistingEnvironment(
    projectRoot,
    dependencies,
    await runRequired(dependencies, {
      args: [...GH_API_ARGS, ENVIRONMENT_ENDPOINT],
      command: 'gh',
      cwd: projectRoot,
    }),
  )
  if (state !== 'compatible') {
    throw new Error('GitHub npm environment verification failed.')
  }
}

export async function createAndVerifyRuleset(
  projectRoot: string,
  dependencies: BootstrapDependencies,
) {
  if ((await inspectRepositoryMergePolicy(projectRoot, dependencies)) === 'pending') {
    dependencies.writeLine('[github] disable merge commits; preserve squash and rebase')
    await runMutation(dependencies, {
      args: [...GH_API_ARGS, '--method', 'PATCH', REPOSITORY_ENDPOINT, '--input', '-'],
      command: 'gh',
      cwd: projectRoot,
      input: JSON.stringify(createRepositoryMergePolicyPayload()),
    })
    if ((await inspectRepositoryMergePolicy(projectRoot, dependencies)) !== 'compatible') {
      throw new Error('GitHub repository merge policy verification failed.')
    }
  }

  const rulesetState = await inspectRuleset(projectRoot, dependencies)
  if (rulesetState === 'conflict') {
    throw new Error('GitHub managed main ruleset conflicts with the required policy.')
  }
  if (rulesetState === 'pending') {
    dependencies.writeLine(`[github] create additive ${MANAGED_RULESET_NAME} ruleset`)
    const created = parseJsonObject(
      await runMutation(dependencies, {
        args: [...GH_API_ARGS, '--method', 'POST', RULESETS_ENDPOINT, '--input', '-'],
        command: 'gh',
        cwd: projectRoot,
        input: JSON.stringify(createRulesetPayload()),
      }),
      'GitHub ruleset creation',
    )
    if (typeof created.id !== 'number') {
      throw new Error('GitHub ruleset creation did not return a numeric id.')
    }
    const ruleset = parseJson(
      await runRequired(dependencies, {
        args: [...GH_API_ARGS, `${RULESETS_ENDPOINT}/${String(created.id)}`],
        command: 'gh',
        cwd: projectRoot,
      }),
      'GitHub managed ruleset',
    )
    if (!isCompatibleRuleset(ruleset)) {
      throw new Error('GitHub managed main ruleset verification failed.')
    }
  }
}
