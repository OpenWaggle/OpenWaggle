import { describe, expect, it } from 'vitest'
import {
  DEDICATED_PUBLISH,
  FORBIDDEN_INSTALL_STEPS,
  INJECTED_PUBLICATION_COMMANDS,
  MODIFIED_PUBLICATION_INVOCATIONS,
  NPM_VERSION_CHECK,
  PUBLICATION_JOB_NAMES,
  replaceInJob,
  validateWorkflow,
  WEAKENED_CAPABILITIES,
  workflowWithDedicatedPublisher,
} from './package-release-validator-run-security.fixtures'

describe('package release workflow publication boundary', () => {
  it.each([
    [
      'scalar permission alias',
      'jobs:\n  unauthorized:\n    name: &write_all write-all\n    permissions: *write_all\n    steps:\n      - run: echo unauthorized\n',
    ],
    [
      'job map alias',
      'jobs:\n  template: &job\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo template\n  unauthorized: *job\n',
    ],
  ])('rejects YAML aliases and anchors: %s', async (_name, jobsPrefix) => {
    const result = await validateWorkflow(
      workflowWithDedicatedPublisher().replace('jobs:\n', jobsPrefix),
    )

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml must not use YAML aliases or anchors.',
    )
  })

  it('rejects an alias anchored on an actual publication job', async () => {
    const result = await validateWorkflow(
      workflowWithDedicatedPublisher()
        .replace('  publish-bases:', '  publish-bases: &publisher')
        .replace('  publish-dependents:', '  unauthorized: *publisher\n\n  publish-dependents:'),
    )

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml must not use YAML aliases or anchors.',
    )
  })

  it.each(
    PUBLICATION_JOB_NAMES.flatMap((jobName) =>
      FORBIDDEN_INSTALL_STEPS.map((step) => [jobName, step]),
    ),
  )('rejects dependency and package-manager installation in %s', async (jobName, step) => {
    const result = await validateWorkflow(
      replaceInJob(
        workflowWithDedicatedPublisher(),
        jobName,
        '      - uses: actions/download-artifact@',
        `${step}      - uses: actions/download-artifact@`,
      ),
    )

    expect(result.violations).toContain(
      `.github/workflows/package-release.yml ${jobName} must not install dependencies or package managers in an OIDC publication job.`,
    )
  })

  it.each(PUBLICATION_JOB_NAMES)(
    'rejects publication Node version drift in %s',
    async (jobName) => {
      const result = await validateWorkflow(
        replaceInJob(
          workflowWithDedicatedPublisher(),
          jobName,
          '          node-version: 24.14.0',
          '          node-version: 24.13.0',
        ),
      )

      expect(result.violations).toContain(
        `.github/workflows/package-release.yml ${jobName} must pin Node 24.14.0 and verify npm 11.9.0 before publication.`,
      )
    },
  )

  it.each(PUBLICATION_JOB_NAMES)(
    'rejects a missing trusted-publishing npm version check in %s',
    async (jobName) => {
      const result = await validateWorkflow(
        replaceInJob(workflowWithDedicatedPublisher(), jobName, NPM_VERSION_CHECK, ''),
      )

      expect(result.violations).toContain(
        `.github/workflows/package-release.yml ${jobName} must pin Node 24.14.0 and verify npm 11.9.0 before publication.`,
      )
    },
  )

  it.each(
    PUBLICATION_JOB_NAMES.flatMap((jobName) =>
      MODIFIED_PUBLICATION_INVOCATIONS.map((invocation) => [jobName, invocation] as const),
    ),
  )('rejects a modified dedicated publication invocation in %s', async (jobName, invocation) => {
    const result = await validateWorkflow(
      replaceInJob(workflowWithDedicatedPublisher(), jobName, DEDICATED_PUBLISH, invocation),
    )

    expect(result.violations).toEqual(
      expect.arrayContaining([
        `.github/workflows/package-release.yml ${jobName} must match its exact allowlisted job contract.`,
        '.github/workflows/package-release.yml must invoke only the dedicated publication command in publish-bases and publish-dependents.',
      ]),
    )
  })

  it.each(
    PUBLICATION_JOB_NAMES.flatMap((jobName) =>
      INJECTED_PUBLICATION_COMMANDS.map((command) => [jobName, command] as const),
    ),
  )('rejects an extra command injected into %s: %s', async (jobName, command) => {
    const result = await validateWorkflow(
      replaceInJob(
        workflowWithDedicatedPublisher(),
        jobName,
        '      - uses: actions/download-artifact@',
        `      - name: Injected publication\n        run: ${command}\n\n      - uses: actions/download-artifact@`,
      ),
    )

    expect(result.violations).toContain(
      `.github/workflows/package-release.yml ${jobName} must match its exact allowlisted job contract.`,
    )
  })

  it.each(PUBLICATION_JOB_NAMES)(
    'rejects obfuscated publication appended to an allowlisted run block in %s',
    async (jobName) => {
      const result = await validateWorkflow(
        replaceInJob(
          workflowWithDedicatedPublisher(),
          jobName,
          '        run: |\n          set -euo pipefail',
          '        run: |\n          set -euo pipefail\n          n\\pm publish malicious.tgz',
        ),
      )

      expect(result.violations).toContain(
        `.github/workflows/package-release.yml ${jobName} must match its exact allowlisted job contract.`,
      )
    },
  )

  it.each(['environment: npm', 'permissions:\n      id-token: write'])(
    'rejects publication capability on an unauthorized job: %s',
    async (capability) => {
      const result = await validateWorkflow(
        workflowWithDedicatedPublisher().replace(
          'jobs:\n',
          `jobs:\n  unauthorized:\n    ${capability}\n    steps:\n      - run: echo unauthorized\n`,
        ),
      )

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must reserve id-token: write and environment declarations for publish-bases and publish-dependents.',
      )
    },
  )

  it.each([
    'environment: ${{ \'npm\' }}',
    'permissions: write-all',
  ])('rejects fail-closed publication capability on an unauthorized job: %s', async (capability) => {
    const result = await validateWorkflow(
      workflowWithDedicatedPublisher().replace(
        'jobs:\n',
        `jobs:\n  unauthorized:\n    ${capability}\n    steps:\n      - run: echo unauthorized\n`,
      ),
    )

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml must reserve id-token: write and environment declarations for publish-bases and publish-dependents.',
    )
  })

  it.each([
    ['defaults:\n  run:\n    shell: bash', 'workflow defaults.run.shell'],
    ['env:\n  PATH: /tmp/attacker', 'workflow env'],
  ])('rejects inherited %s', async (injectedControl) => {
    const result = await validateWorkflow(
      workflowWithDedicatedPublisher().replace(
        'concurrency:\n',
        `${injectedControl}\nconcurrency:\n`,
      ),
    )

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml must forbid workflow-level env and defaults and grant exactly contents: read.',
    )
  })

  it('rejects workflow permissions write-all', async () => {
    const result = await validateWorkflow(
      workflowWithDedicatedPublisher().replace(
        'permissions:\n  contents: read',
        'permissions: write-all',
      ),
    )

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml must forbid workflow-level env and defaults and grant exactly contents: read.',
    )
  })

  it.each([
    'defaults:\n      run:\n        shell: bash',
    'env:\n      PATH: /tmp/attacker',
    'container: attacker/image:latest',
    'services:\n      attacker:\n        image: attacker/image:latest',
    'timeout-minutes: 999',
  ])('rejects publication job control changes: %s', async (jobControl) => {
    const result = await validateWorkflow(
      replaceInJob(
        workflowWithDedicatedPublisher(),
        'publish-bases',
        '    runs-on: ubuntu-latest',
        `    runs-on: ubuntu-latest\n    ${jobControl}`,
      ),
    )

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml publish-bases must match its exact allowlisted job contract.',
    )
  })

  it.each(PUBLICATION_JOB_NAMES)(
    'rejects hash-only job mutations symmetrically for %s',
    async (jobName) => {
      const result = await validateWorkflow(
        replaceInJob(
          workflowWithDedicatedPublisher(),
          jobName,
          '    runs-on: ubuntu-latest',
          '    runs-on: ubuntu-latest\n    timeout-minutes: 999',
        ),
      )

      expect(result.violations).toContain(
        `.github/workflows/package-release.yml ${jobName} must match its exact allowlisted job contract.`,
      )
    },
  )

  it.each(PUBLICATION_JOB_NAMES)(
    'rejects publication-step shell overrides for %s',
    async (jobName) => {
      const result = await validateWorkflow(
        replaceInJob(
          workflowWithDedicatedPublisher(),
          jobName,
          `        run: ${DEDICATED_PUBLISH}`,
          `        shell: bash\n        run: ${DEDICATED_PUBLISH}`,
        ),
      )

      expect(result.violations).toEqual(
        expect.arrayContaining([
          `.github/workflows/package-release.yml ${jobName} must match its exact allowlisted job contract.`,
          '.github/workflows/package-release.yml must invoke only the dedicated publication command in publish-bases and publish-dependents.',
        ]),
      )
    },
  )

  it.each(PUBLICATION_JOB_NAMES)(
    'rejects job-level shell overrides symmetrically for %s',
    async (jobName) => {
      const result = await validateWorkflow(
        replaceInJob(
          workflowWithDedicatedPublisher(),
          jobName,
          '    runs-on: ubuntu-latest',
          '    runs-on: ubuntu-latest\n    defaults:\n      run:\n        shell: bash',
        ),
      )

      expect(result.violations).toContain(
        `.github/workflows/package-release.yml ${jobName} must match its exact allowlisted job contract.`,
      )
    },
  )

  it.each(
    PUBLICATION_JOB_NAMES.flatMap((jobName) =>
      WEAKENED_CAPABILITIES.map(([field, replacement]) =>
        [jobName, field, replacement] as const,
      ),
    ),
  )('rejects weakened publication capability in %s: %s', async (jobName, field, replacement) => {
    const result = await validateWorkflow(
      replaceInJob(workflowWithDedicatedPublisher(), jobName, field, replacement),
    )

    expect(result.violations).toContain(
      `.github/workflows/package-release.yml ${jobName} must exclusively hold id-token: write with environment npm.`,
    )
  })
})
