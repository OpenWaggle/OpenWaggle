import type {
  BootstrapCommandRequest,
  BootstrapCommandResult,
  BootstrapDependencies,
} from '../package-release-bootstrap'


export const PACKAGE_NAMES = [
  '@openwaggle/extension-sdk',
  '@openwaggle/extension-react',
  '@openwaggle/waggle-core',
  '@openwaggle/pi-waggle',
] as const

interface CompatibleRulesetFixture {
  readonly [key: string]: unknown
  rules: unknown[]
}

export function compatibleTrustConfiguration() {
  return {
    environment: 'npm',
    file: 'package-release.yml',
    permissions: ['createPackage'],
    repository: 'OpenWaggle/OpenWaggle',
    type: 'github',
  }
}

export function publicAccess(packageName: string) {
  return successful(JSON.stringify({ [packageName]: 'public' }))
}

export function successfulFirstPackageTransaction(packageName: string) {
  return new Map<string, BootstrapCommandResult>([
    ['pnpm check', successful()],
    [
      'npm access list packages maintainer --json',
      successful(JSON.stringify({ [packageName]: 'read-write' })),
    ],
    ['npm publish --tag bootstrap --access public --ignore-scripts', successful()],
    [`npm access set mfa=publish ${packageName}`, successful()],
    [
      `npm trust github ${packageName} --file package-release.yml --repository OpenWaggle/OpenWaggle --environment npm --allow-publish --yes`,
      successful(),
    ],
    [
      `npm deprecate ${packageName}@0.0.0-bootstrap.0 Namespace bootstrap placeholder; use a released version.`,
      successful(),
    ],
    [
      `npm trust list ${packageName} --json`,
      successful(JSON.stringify(compatibleTrustConfiguration())),
    ],
    [
      `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
      successful(JSON.stringify({
        deprecated: 'Namespace bootstrap placeholder; use a released version.',
        files: [],
        name: packageName,
        openwaggleNamespaceBootstrap: true,
        version: '0.0.0-bootstrap.0',
      })),
    ],
    [
      `npm view ${packageName} dist-tags --json`,
      successful(JSON.stringify({ bootstrap: '0.0.0-bootstrap.0' })),
    ],
    [`npm access get status ${packageName} --json`, publicAccess(packageName)],
  ])
}

export function compatibleRuleset(
  requiredStatusChecks: unknown[] = [
    { context: 'Commit Policy' },
    { context: 'Typecheck & Lint' },
    { context: 'Unit & Component Tests' },
  ],
): CompatibleRulesetFixture {
  return {
    bypass_actors: [
      { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
    ],
    conditions: { ref_name: { exclude: [], include: ['refs/heads/main'] } },
    enforcement: 'active',
    id: 42,
    name: 'OpenWaggle main protections',
    source: 'OpenWaggle/OpenWaggle',
    source_type: 'Repository',
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        parameters: {
          allowed_merge_methods: ['squash', 'rebase'],
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
        },
        type: 'pull_request',
      },
      {
        parameters: {
          do_not_enforce_on_create: true,
          required_status_checks: requiredStatusChecks,
          strict_required_status_checks_policy: true,
        },
        type: 'required_status_checks',
      },
    ],
    target: 'branch',
  }
}

export function addCompatibleGithubState(
  overrides: Map<string, BootstrapCommandResult>,
) {
  overrides.set(
    'gh api --hostname github.com repos/OpenWaggle/OpenWaggle',
    successful(
      JSON.stringify({
        allow_merge_commit: false,
        allow_rebase_merge: true,
        allow_squash_merge: true,
      }),
    ),
  )
  overrides.set(
    'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm',
    successful(
      JSON.stringify({
        deployment_branch_policy: {
          custom_branch_policies: true,
          protected_branches: false,
        },
        protection_rules: [{ type: 'branch_policy' }],
      }),
    ),
  )
  overrides.set(
    'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm/deployment-branch-policies?per_page=2',
    successful(JSON.stringify({ branch_policies: [{ name: 'main', type: 'branch' }] })),
  )
  overrides.set(
    'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm/secrets?per_page=1',
    successful(JSON.stringify({ secrets: [], total_count: 0 })),
  )
  overrides.set(
    'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets?includes_parents=false&per_page=100 --paginate --slurp',
    successful(JSON.stringify([[{ id: 42, name: 'OpenWaggle main protections' }]])),
  )
  overrides.set(
    'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets/42',
    successful(JSON.stringify(compatibleRuleset())),
  )
}

export function addCompatiblePackageState(
  overrides: Map<string, BootstrapCommandResult>,
) {
  for (const packageName of PACKAGE_NAMES) {
    overrides.set(
      `npm view ${packageName} --json`,
      successful(JSON.stringify({ name: packageName })),
    )
    overrides.set(
      `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
      successful(
        JSON.stringify({
          deprecated: 'Namespace bootstrap placeholder; use a released version.',
          files: [],
          name: packageName,
          openwaggleNamespaceBootstrap: true,
          version: '0.0.0-bootstrap.0',
        }),
      ),
    )
    overrides.set(
      `npm view ${packageName} dist-tags --json`,
      successful(JSON.stringify({ bootstrap: '0.0.0-bootstrap.0' })),
    )
    overrides.set(`npm access get status ${packageName} --json`, publicAccess(packageName))
    overrides.set(
      `npm trust list ${packageName} --json`,
      successful(
        JSON.stringify(compatibleTrustConfiguration()),
      ),
    )
  }
}

export function commandKey(request: BootstrapCommandRequest) {
  return [request.command, ...request.args].join(' ')
}

export function successful(stdout = ''): BootstrapCommandResult {
  return { exitCode: 0, stderr: '', stdout }
}

function missingPackage(): BootstrapCommandResult {
  return { exitCode: 1, stderr: 'npm error code E404', stdout: '' }
}

export function createDependencies(
  overrides: ReadonlyMap<string, BootstrapCommandResult> = new Map(),
  sequenceOverrides: Map<string, BootstrapCommandResult[]> = new Map(),
  environment: Readonly<Record<string, string | undefined>> = {},
) {
  const requests: BootstrapCommandRequest[] = []
  const removedDirectories: string[] = []
  const writtenFiles: Array<{ readonly contents: string; readonly filePath: string }> = []
  const files: BootstrapDependencies['files'] = {
    makeTempDirectory: async () => '/tmp/openwaggle-bootstrap-test',
    removeDirectory: async (directory) => {
      removedDirectories.push(directory)
    },
    writeFile: async (filePath, contents) => {
      writtenFiles.push({ contents, filePath })
    },
  }
  const defaults = new Map<string, BootstrapCommandResult>([
    ['node --version', successful('v24.0.0\n')],
    ['npm --version', successful('11.18.0\n')],
    ['npm config get registry', successful('https://registry.npmjs.org/\n')],
    ['git status --porcelain', successful()],
    ['git branch --show-current', successful('main\n')],
    ['git remote get-url origin', successful('git@github.com:OpenWaggle/OpenWaggle.git\n')],
    ['git rev-parse HEAD', successful('abc123\n')],
    [
      'git ls-remote --exit-code origin refs/heads/main',
      successful('abc123\trefs/heads/main\n'),
    ],
    ['npm whoami', successful('maintainer\n')],
    [
      'npm profile get --json',
      successful(JSON.stringify({ name: 'maintainer', tfa: { mode: 'auth-and-writes' } })),
    ],
    [
      'npm org ls openwaggle maintainer --json',
      successful(JSON.stringify({ maintainer: 'owner' })),
    ],
    ['gh auth status --active --hostname github.com', successful()],
    [
      'gh api --hostname github.com repos/OpenWaggle/OpenWaggle --jq .permissions.admin',
      successful('true\n'),
    ],
    [
      'gh api --hostname github.com repos/OpenWaggle/OpenWaggle',
      successful(
        JSON.stringify({
          allow_merge_commit: false,
          allow_rebase_merge: true,
          allow_squash_merge: true,
        }),
      ),
    ],
    [
      'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm',
      { exitCode: 1, stderr: 'HTTP 404: Not Found', stdout: '' },
    ],
    [
      'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets?includes_parents=false&per_page=100 --paginate --slurp',
      successful('[[]]'),
    ],
  ])

  for (const packageName of PACKAGE_NAMES) {
    defaults.set(`npm view ${packageName} --json`, missingPackage())
    defaults.set(
      `npm view ${packageName} versions --json`,
      successful(JSON.stringify(['0.0.0-bootstrap.0'])),
    )
  }

  return {
    dependencies: {
      commands: {
        run: async (request) => {
          requests.push(request)
          const key = commandKey(request)
          const sequence = sequenceOverrides.get(key)
          const result = sequence?.shift() ?? overrides.get(key) ?? defaults.get(key)
          if (!result) {
            throw new Error(`Unexpected command: ${key}`)
          }
          return result
        },
      },
      environment,
      files,
      interruptions: {
        protect: (operation) => operation(),
      },
      writeLine: () => undefined,
    } satisfies BootstrapDependencies,
    requests,
    removedDirectories,
    writtenFiles,
  }
}
