/**
 * Files that an ADR or a doc describes, so a change to them should update that doc (DOC-01). The
 * gate reports an advisory line, never a block: plenty of changes leave the doc true. Each entry
 * lists path prefixes and the docs that describe them; a change passes when the Session also
 * changed one of those docs.
 */
export interface DocWatch {
  readonly paths: readonly string[]
  readonly docs: readonly string[]
}

export const DOC_WATCHES: readonly DocWatch[] = [
  {
    paths: ['oxlint.config.mts', 'scripts/lint.ts', 'scripts/oxlint/', '.oxfmtrc.json'],
    docs: [
      '.agents/standards.md',
      '.agents/memory/tooling.md',
      'docs/adr/0064-move-the-toolchain-and-desktop-shell-to-bun.md',
    ],
  },
  {
    paths: [
      'scripts/agent-gate/',
      'scripts/agent-quality-gates/',
      'scripts/agent-guardrails/',
      '.pi/extensions/',
    ],
    docs: ['.agents/verification.md', '.agents/memory/tooling.md'],
  },
  { paths: ['.agents/rules.json'], docs: ['.agents/standards.md'] },
  {
    paths: [
      'bunfig.toml',
      'scripts/check-provenance-downgrade.ts',
      'scripts/provenance-downgrade-policy.ts',
    ],
    docs: ['docs/dependency-updates.md'],
  },
  { paths: ['patches/'], docs: ['DEPENDENCIES.md', 'docs/dependency-updates.md'] },
  {
    paths: ['.github/workflows/', 'release-please-config.json', 'scripts/app-release-'],
    docs: ['docs/release-and-versioning.md', '.agents/memory/release-and-ci.md'],
  },
  { paths: ['.husky/', 'scripts/git-hooks/'], docs: ['.agents/verification.md'] },
  {
    paths: ['src/main/adapters/pi/', 'packages/pi-waggle/'],
    docs: ['.agents/skills/pi-integration/SKILL.md', '.agents/memory/pi-runtime.md'],
  },
  {
    paths: ['src/main/session-host/'],
    docs: ['.agents/memory/session-host.md', 'docs/system-architecture.md'],
  },
  { paths: ['src/main/ports/'], docs: ['docs/hexagonal-architecture.md'] },
  {
    paths: ['src/renderer/src/features/', 'src/renderer/src/shell/'],
    docs: ['docs/renderer-architecture.md', '.agents/memory/renderer.md'],
  },
  { paths: ['src/shared/schemas/'], docs: ['website/src/content/docs/'] },
  {
    paths: ['src/main/agents/'],
    docs: ['website/src/content/docs/extending/agent-definitions.md', '.agents/memory/hive.md'],
  },
  {
    paths: ['src/main/services/database-'],
    docs: ['.agents/memory/persistence-and-migrations.md'],
  },
]

function covers(prefix: string, file: string) {
  return file.startsWith(prefix)
}

/**
 * One advisory per watch whose files are in `changed` while none of its docs is in `updated`
 * (by default the same list).
 */
export function staleDocs(
  changed: readonly string[],
  updated: readonly string[] = changed,
  watches: readonly DocWatch[] = DOC_WATCHES,
) {
  return watches.flatMap((watch) => {
    const touched = changed.filter((file) => watch.paths.some((prefix) => covers(prefix, file)))
    const docUpdated = updated.some((file) => watch.docs.some((doc) => covers(doc, file)))
    return touched.length === 0 || docUpdated
      ? []
      : [{ file: touched[0] ?? '', touched, docs: watch.docs }]
  })
}
