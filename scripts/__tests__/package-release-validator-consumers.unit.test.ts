import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePackageReleaseFiles } from '../package-release-validator'
import {
  validCiWorkflow,
  validWorkflow,
  writeMinimalPackageReleaseProject,
} from './package-release-validator.fixtures'

describe('package release consumer tool validation', () => {
  it('rejects npm and Yarn consumers that are not installed and resolved from an isolated path', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace(
          'run: node .release-tooling/scripts/package-consumer-tools.ts install --tool-root "$RUNNER_TEMP/package-managers" --github-path "$GITHUB_PATH"',
          'env:\n          NODE_OPTIONS: --import=attacker.js\n        run: node .release-tooling/scripts/package-consumer-tools.ts install --tool-root "$RUNNER_TEMP/package-managers" --github-path "$GITHUB_PATH"',
        )
        .replace(
          'run: node .release-tooling/scripts/package-consumer-tools.ts verify --tool-root "$RUNNER_TEMP/package-managers"',
          'if: ${{ false }}\n        run: node .release-tooling/scripts/package-consumer-tools.ts verify --tool-root "$RUNNER_TEMP/package-managers"',
        )
        .replace(
          '      - name: Install pinned package manager consumers',
          '      - run: npx --yes npm@latest i -g npm@latest\n        if: ${{ false }}\n\n      - run: NPM=npm; $NPM i -g npm@latest\n        if: ${{ false }}\n\n      - name: Install pinned package manager consumers',
        )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml release-qa must install npm and Yarn in an isolated runner path.',
          '.github/workflows/package-release.yml release-qa must verify isolated npm and Yarn executable paths.',
          '.github/workflows/package-release.yml release-qa must install package consumer tools only through the typed integrity-pinned installer.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects job-level execution injection and intermediate tooling modification', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace(
          '    runs-on: ubuntu-latest\n    strategy:\n      fail-fast: false',
          '    runs-on: ubuntu-latest\n    env:\n      NODE_OPTIONS: --import=attacker.js\n    strategy:\n      fail-fast: false',
        )
        .replace(
          '      - name: Install pinned package manager consumers',
          '      - name: Modify checked-out release tooling\n        run: echo attacker >> .release-tooling/scripts/package-consumer-tools.ts\n\n      - name: Install pinned package manager consumers',
        )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml release-qa must keep its exact blocking QA job contract.',
          '.github/workflows/package-release.yml release-qa must install package consumer tools only through the typed integrity-pinned installer.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects package-release workflow execution injection and unexpected QA needs', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace(
          'permissions:\n  contents: read',
          'env:\n  NODE_OPTIONS: --import=attacker.js\n\ndefaults:\n  run:\n    shell: bash\n\npermissions:\n  contents: read',
        )
        .replace('    needs: release-plan', '    needs: [release-plan, attacker]')
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml must omit workflow-level environment and defaults from package publishing.',
          '.github/workflows/package-release.yml release-qa must keep its exact blocking QA job contract.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects package consumer tooling steps reordered after installation', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    const checkoutStep = `      - name: Checkout immutable package consumer tooling
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
        with:
          ref: \${{ github.workflow_sha }}
          path: .release-tooling
          sparse-checkout: scripts/package-consumer-tools.ts
          sparse-checkout-cone-mode: false`
    const verifyStep = `      - name: Verify package manager consumer versions
        run: node .release-tooling/scripts/package-consumer-tools.ts verify --tool-root "$RUNNER_TEMP/package-managers"`
    try {
      const invalidWorkflow = validWorkflow
        .replace(`${checkoutStep}\n\n`, '')
        .replace(verifyStep, `${verifyStep}\n\n${checkoutStep}`)
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml release-qa must checkout tooling before installing and verifying package consumers.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects package consumer tooling not checked out from the workflow commit', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace('ref: ${{ github.workflow_sha }}', 'ref: ${{ needs.release-plan.outputs.source_sha }}')
        .replace('sparse-checkout: scripts/package-consumer-tools.ts', 'sparse-checkout: scripts/other.ts')
        .replace('sparse-checkout-cone-mode: false', 'sparse-checkout-cone-mode: true')
        .replace(
          '      - name: Checkout immutable package consumer tooling',
          `      - name: Checkout immutable package consumer tooling
        if: \${{ false }}
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
        with:
          ref: \${{ github.workflow_sha }}
          path: .release-tooling
          sparse-checkout: scripts/package-consumer-tools.ts
          sparse-checkout-cone-mode: false

      - name: Checkout immutable package consumer tooling`,
        )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml release-qa must checkout immutable package consumer tooling from the workflow commit.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects release QA using a source revision other than the release plan output', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        'ref: ${{ needs.release-plan.outputs.source_sha }}',
        'ref: ${{ github.workflow_sha }}',
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml release-qa must execute exactly its approved source checkout, immutable tooling setup, and QA steps in order.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects extra release QA actions and environment injection', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace(
          '      - name: Install pinned package manager consumers',
          '      - uses: attacker/action@main\n\n      - name: Install pinned package manager consumers',
        )
        .replace(
          "          OPENWAGGLE_PACKAGE_BROWSER_SMOKE: '1'",
          "          OPENWAGGLE_PACKAGE_BROWSER_SMOKE: '1'\n          NODE_OPTIONS: --import=attacker.js",
        )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml release-qa must execute exactly its approved source checkout, immutable tooling setup, and QA steps in order.',
          '.github/workflows/package-release.yml release-qa must run browser-enabled package smoke on every Node matrix entry.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects recovery smoke that allows Yarn CI immutable installs', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        "          YARN_ENABLE_IMMUTABLE_INSTALLS: 'false'\n",
        '',
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml release-qa must disable Yarn immutable installs for lockfile-free packed consumers.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects CI without the exact Node 22.19 and Node 24 consumer-tool matrix', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidCiWorkflow = validCiWorkflow.replace(
        / {2}package-consumer-tools:[\s\S]*?\n {2}commit-policy:/u,
        '  commit-policy:',
      )
      await writeMinimalPackageReleaseProject(
        projectRoot,
        validWorkflow,
        '0.1.0',
        'released',
        invalidCiWorkflow,
      )

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/ci.yml package-consumer-tools must test exactly Node 22.19.0 and Node 24.',
          '.github/workflows/ci.yml package-consumer-tools must execute its exact pinned setup, install, and verification steps in order.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects a skipped or non-blocking CI consumer-tool matrix', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidCiWorkflow = validCiWorkflow.replace(
        '  package-consumer-tools:\n    name: Package Consumer Tools (Node ${{ matrix.node }})\n    runs-on: ubuntu-latest',
        '  package-consumer-tools:\n    name: Package Consumer Tools (Node ${{ matrix.node }})\n    if: false\n    continue-on-error: true\n    runs-on: ubuntu-latest',
      )
      await writeMinimalPackageReleaseProject(
        projectRoot,
        validWorkflow,
        '0.1.0',
        'released',
        invalidCiWorkflow,
      )

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/ci.yml package-consumer-tools must keep its exact blocking job contract.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects extra CI consumer-tool actions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidCiWorkflow = validCiWorkflow.replace(
        '      - name: Install pinned package manager consumers',
        '      - uses: attacker/action@main\n\n      - name: Install pinned package manager consumers',
      )
      await writeMinimalPackageReleaseProject(
        projectRoot,
        validWorkflow,
        '0.1.0',
        'released',
        invalidCiWorkflow,
      )

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/ci.yml package-consumer-tools must contain exactly its approved pinned setup, install, and verification steps in order.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects CI workflow-level execution injection and defaults', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidCiWorkflow = validCiWorkflow
        .replace(
          '  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true',
          '  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true\n  NODE_OPTIONS: --import=attacker.js',
        )
        .replace(
          'concurrency:',
          'defaults:\n  run:\n    shell: bash\n\nconcurrency:',
        )
      await writeMinimalPackageReleaseProject(
        projectRoot,
        validWorkflow,
        '0.1.0',
        'released',
        invalidCiWorkflow,
      )

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/ci.yml must keep its exact workflow-level execution environment and omit workflow defaults.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })
})
