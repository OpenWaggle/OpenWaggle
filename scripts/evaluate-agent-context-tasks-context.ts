import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { answerMatches, type EvalTask, grade, usedTool } from './evaluate-agent-context-types'

/** MCP through the fixture server, project skills, and recall across a compaction. */

const INVENTORY_TOOL = /inventory/
const SKILL_TOKEN = 'SKILLTOKEN-7781'
const VAULT_CODE = 'MARMOT-4417'
/** Compaction triggers at this share of the model's window in the compaction tasks. */
const LOW_COMPACTION_PERCENT = 4
const FILLER_PARAGRAPHS = 600
const COMPACTION_TIMEOUT_MS = 900_000

async function files(root: string, entries: Readonly<Record<string, string>>) {
  for (const [relative, content] of Object.entries(entries)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await writeFile(path.join(root, relative), content)
  }
}

function skill(name: string, description: string, body: string) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`
}

const DISTRACTOR_SKILLS = {
  '.agents/skills/api-pagination/SKILL.md': skill('api-pagination', 'Use when adding cursor pagination to an HTTP endpoint.', 'Return `next_cursor` and cap pages at 100.'),
  '.agents/skills/sql-migrations/SKILL.md': skill('sql-migrations', 'Use when writing a database migration.', 'Every migration needs a down step.'),
  '.agents/skills/i18n-strings/SKILL.md': skill('i18n-strings', 'Use when adding user-facing strings.', 'Put strings in locales/en.json.'),
}

/** Long prose a model must read in full; the fact sits in its first paragraph. */
function longNotes(fact: string) {
  const filler = Array.from(
    { length: FILLER_PARAGRAPHS },
    (_, index) => `Paragraph ${String(index + 1)}. The quarterly maintenance window covers the cache tier, the queue workers and the report exporters, and each owner signs off before traffic returns.`,
  )
  return `${fact}\n\n${filler.join('\n\n')}\n`
}

export const CONTEXT_TASKS: readonly EvalTask[] = [
  {
    id: 'mcp-lookup-one',
    group: 'mcp-codemode',
    mcpInventory: true,
    prompt: () => 'Using the inventory MCP server, how many units of SKU A-1042 are in stock?',
    grade: (outcome) => grade(usedTool(outcome, INVENTORY_TOOL) && answerMatches(outcome, /\b17\b/), 'inventory used; 17 units'),
    reference: { answer: '17 units.', toolNames: ['codemode:mcp__inventory__lookup_sku'] },
  },
  {
    id: 'mcp-compare-two',
    group: 'mcp-codemode',
    mcpInventory: true,
    prompt: () => 'Using the inventory MCP server, which of SKUs A-1042 and B-2001 has more units in stock, and how many?',
    grade: (outcome) => grade(usedTool(outcome, INVENTORY_TOOL) && answerMatches(outcome, /B-2001/) && answerMatches(outcome, /\b64\b/), 'B-2001 with 64'),
    reference: { answer: 'B-2001 has more: 64 units.', toolNames: ['mcp__inventory__lookup_sku'] },
  },
  {
    id: 'mcp-write-result',
    group: 'mcp-codemode',
    mcpInventory: true,
    prompt: () => 'Look up which warehouse holds SKU C-3003 with the inventory MCP server and write just the warehouse name into warehouse.txt.',
    inspectFiles: ['warehouse.txt'],
    grade: (outcome) => grade((outcome.files['warehouse.txt'] ?? '').trim() === 'Faro', 'warehouse.txt is Faro'),
    reference: { files: { 'warehouse.txt': 'Faro\n' }, toolNames: ['codemode:mcp__inventory__lookup_sku'] },
  },
  {
    id: 'skills-follow-instructions',
    group: 'skills',
    prompt: () => "Write release notes for version 2.0 (one bullet: 'Faster startup') into NOTES.md, following this project's release-notes skill.",
    setup: (root) =>
      files(root, {
        ...DISTRACTOR_SKILLS,
        '.agents/skills/release-notes/SKILL.md': skill(
          'release-notes',
          'Use when writing release notes or a changelog entry for this project.',
          'Release notes must start with the exact line `## Release Quokka <version>` and every bullet starts with `* ` (asterisk), never `- `.',
        ),
      }),
    inspectFiles: ['NOTES.md'],
    grade: (outcome) => {
      const notes = outcome.files['NOTES.md'] ?? ''
      return grade(/^## Release Quokka (v)?2\.0\s*$/m.test(notes.split('\n')[0] ?? '') && /^\* /m.test(notes) && !/^- /m.test(notes), 'follows the skill format')
    },
    reference: { files: { 'NOTES.md': '## Release Quokka 2.0\n\n* Faster startup\n' } },
  },
  {
    id: 'skills-select-matching',
    group: 'skills',
    prompt: () => "I staged a change that fixes a typo in README.md. Write its commit message into COMMIT_MSG.txt following this project's commit message skill. Do not commit.",
    setup: (root) =>
      files(root, {
        ...DISTRACTOR_SKILLS,
        '.agents/skills/commit-messages/SKILL.md': skill(
          'commit-messages',
          'Use when writing a git commit message for this repository.',
          'Commit subjects start with `[eval] ` followed by a type such as `docs:` or `fix:`, all lowercase, at most 60 characters.',
        ),
        'README.md': '# Widgets\n\nTeh quick start guide is below.\n',
      }),
    afterCommit: async (root) => {
      await writeFile(path.join(root, 'README.md'), '# Widgets\n\nThe quick start guide is below.\n')
      execFileSync('git', ['add', 'README.md'], { cwd: root })
    },
    inspectFiles: ['COMMIT_MSG.txt'],
    grade: (outcome) => grade(/^\[eval\] (docs|fix|chore):/.test((outcome.files['COMMIT_MSG.txt'] ?? '').trim()), 'subject starts with [eval] type:'),
    reference: { files: { 'COMMIT_MSG.txt': '[eval] docs: fix typo in readme\n' } },
  },
  {
    id: 'skills-bundled-script',
    group: 'skills',
    prompt: () => "Use this project's token-generator skill to produce today's deployment token, and tell me the token.",
    setup: (root) =>
      files(root, {
        ...DISTRACTOR_SKILLS,
        '.agents/skills/token-generator/SKILL.md': skill(
          'token-generator',
          'Use when asked for a deployment token.',
          'Run `node scripts/token.mjs` from this skill\'s directory and report its output verbatim.',
        ),
        '.agents/skills/token-generator/scripts/token.mjs': `console.log(['SKILLTOKEN', 7700 + 81].join('-'))\n`,
      }),
    grade: (outcome) => grade(answerMatches(outcome, new RegExp(SKILL_TOKEN)), 'ran the skill script by its path'),
    reference: { answer: SKILL_TOKEN },
  },
  {
    id: 'compaction-recall-start',
    group: 'compaction-recall',
    settings: { compactionThresholdPercent: LOW_COMPACTION_PERCENT },
    prompt: () =>
      'Read notes.txt completely (it is long; read it in full, all pages), then read appendix.txt completely. Then tell me the vault code mentioned in the first paragraph of notes.txt.',
    setup: (root) => files(root, { 'notes.txt': longNotes(`The vault code is ${VAULT_CODE}.`), 'appendix.txt': longNotes('Appendix.') }),
    grade: (outcome) => grade(outcome.compactions > 0 && answerMatches(outcome, new RegExp(VAULT_CODE)), 'compacted and still recalls the code'),
    reference: { answer: `The vault code is ${VAULT_CODE}.`, compactions: 1 },
    timeoutMs: COMPACTION_TIMEOUT_MS,
  },
  {
    id: 'compaction-recall-decision',
    group: 'compaction-recall',
    settings: { compactionThresholdPercent: LOW_COMPACTION_PERCENT },
    prompt: () =>
      'First, decide on a name for our new cache service: call it "Heronstore" and remember that decision. Then read notes.txt and appendix.txt completely (both are long; read every page). Finally, write the cache service name we decided on into decision.txt.',
    setup: (root) => files(root, { 'notes.txt': longNotes('Notes.'), 'appendix.txt': longNotes('Appendix.') }),
    inspectFiles: ['decision.txt'],
    grade: (outcome) => grade(outcome.compactions > 0 && (outcome.files['decision.txt'] ?? '').includes('Heronstore'), 'compacted and keeps the decision'),
    reference: { files: { 'decision.txt': 'Heronstore\n' }, compactions: 1 },
    timeoutMs: COMPACTION_TIMEOUT_MS,
  },
]
