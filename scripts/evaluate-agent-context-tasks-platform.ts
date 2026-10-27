import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { answerMatches, type EvalTask, grade, usedTool } from './evaluate-agent-context-types'

/**
 * OpenWaggle's own tools: rarely used first-party tools (which v1 makes reachable through codemode
 * and tool search instead of declaring them), the Hive, and the browser preview.
 */

const SOURCE_CONTROL = /^(source_control|codemode:source_control)$/
const PROJECT_ACTIONS = /^(project_actions|codemode:project_actions)$/
const DOCS = /^(openwaggle_docs|codemode:openwaggle_docs)$/
const HIVE = /^(hive|codemode:hive)$/
const PREVIEW = /^(codemode:)?preview_/
/** A Session `hive-find-session` creates before its Run, which the agent must find. */
const OTHER_SESSION_TITLE = 'Pelican migration notes 1987'

async function writeProjectFile(root: string, relative: string, content: string) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
  await writeFile(path.join(root, relative), content)
}

export const PLATFORM_TASKS: readonly EvalTask[] = [
  {
    id: 'tools-source-control-host',
    group: 'deferred-first-party-tools',
    prompt: () =>
      "Use OpenWaggle's source control tool (not git or shell commands) to find out which kind of source control host this repository's remote is on and which repository it names. Answer briefly.",
    setup: async (root) => {
      execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme-labs/widget-forge.git'], { cwd: root })
    },
    grade: (outcome) =>
      grade(usedTool(outcome, SOURCE_CONTROL) && answerMatches(outcome, /github/i) && answerMatches(outcome, /widget-forge/i), 'source_control used; GitHub acme-labs/widget-forge'),
    reference: { answer: 'GitHub, acme-labs/widget-forge.', toolNames: ['source_control'] },
  },
  {
    id: 'tools-project-actions-list',
    group: 'deferred-first-party-tools',
    prompt: () => "Use OpenWaggle's project actions tool to list the tasks this project offers. Which task name contains the word 'fixture'?",
    setup: (root) =>
      writeProjectFile(root, 'package.json', `${JSON.stringify({ name: 'eval-actions', private: true, scripts: { build: 'node -e 0', 'seed:fixture-heron': 'node -e 0', test: 'node -e 0' } })}\n`),
    grade: (outcome) => grade(usedTool(outcome, PROJECT_ACTIONS) && answerMatches(outcome, /seed:fixture-heron/), 'project_actions used; names the task'),
    reference: { answer: 'seed:fixture-heron', toolNames: ['project_actions'] },
  },
  {
    id: 'tools-docs-exit-code',
    group: 'deferred-first-party-tools',
    prompt: () =>
      "Using the installed OpenWaggle documentation (the docs tool), what exit status does `openwaggle run` return when a question outlasts --interaction-timeout-ms? Answer with the number.",
    grade: (outcome) => grade(usedTool(outcome, DOCS) && answerMatches(outcome, /\b7\b/), 'openwaggle_docs used; answers 7'),
    reference: { answer: 'It exits with 7.', toolNames: ['openwaggle_docs'] },
  },
  {
    id: 'tools-docs-mcp-idle',
    group: 'deferred-first-party-tools',
    prompt: () =>
      "Look it up in the installed OpenWaggle documentation with the docs tool: how long after a session's last message do its MCP servers stop?",
    grade: (outcome) =>
      grade(usedTool(outcome, DOCS) && answerMatches(outcome, /\b(5|five)[- ]minutes?\b/i), 'openwaggle_docs used; 5 minutes'),
    reference: { answer: 'After 5 minutes without a new message.', toolNames: ['openwaggle_docs'] },
  },
  {
    id: 'hive-spawn-and-wait',
    group: 'hive',
    prompt: () =>
      'Spawn one Worker Session in this same workspace whose only job is to create the file worker.txt containing exactly the word heron. Wait for it to finish, check the file, then tell me what it contains.',
    inspectFiles: ['worker.txt'],
    grade: (outcome) =>
      grade(usedTool(outcome, HIVE) && outcome.sessionCount >= 2 && (outcome.files['worker.txt'] ?? '').trim() === 'heron', 'a Worker wrote worker.txt'),
    reference: { files: { 'worker.txt': 'heron\n' }, toolNames: ['hive'], sessionCount: 2 },
    timeoutMs: 600_000,
  },
  {
    id: 'hive-find-session',
    group: 'hive',
    prompt: () => 'Another Session in this project is about pelican migration. Use the hive tool to find it and tell me its exact title.',
    otherSessions: [OTHER_SESSION_TITLE],
    grade: (outcome) => grade(usedTool(outcome, HIVE) && answerMatches(outcome, /Pelican migration notes 1987/), 'hive used; finds the other Session'),
    reference: { answer: 'It is "Pelican migration notes 1987".', toolNames: ['hive'] },
  },
  {
    id: 'hive-two-workers',
    group: 'hive',
    prompt: () =>
      'Spawn two Worker Sessions in this workspace: one writes the word north into a.txt, the other writes the word south into b.txt. Wait for both, then reply with both words.',
    inspectFiles: ['a.txt', 'b.txt'],
    grade: (outcome) =>
      grade(
        outcome.sessionCount >= 3 && (outcome.files['a.txt'] ?? '').trim() === 'north' && (outcome.files['b.txt'] ?? '').trim() === 'south',
        'two Workers wrote their files',
      ),
    reference: { files: { 'a.txt': 'north', 'b.txt': 'south' }, sessionCount: 3, toolNames: ['hive'] },
    timeoutMs: 600_000,
  },
  {
    id: 'preview-read-total',
    group: 'browser-preview',
    prompt: (context) => `Open ${context.previewUrl ?? ''} in OpenWaggle's browser preview and tell me the Total shown on the page.`,
    previewPage: '<!doctype html><title>Quokka Dashboard</title><h1>Quokka Dashboard</h1><p id="total">Total: 4242</p>',
    grade: (outcome) => grade(usedTool(outcome, PREVIEW) && answerMatches(outcome, /4,?242/), 'preview used; reads 4242'),
    reference: { answer: 'The Total is 4242.', toolNames: ['preview_open', 'preview_snapshot'] },
  },
  {
    id: 'preview-click-reveal',
    group: 'browser-preview',
    prompt: (context) =>
      `Open ${context.previewUrl ?? ''} in OpenWaggle's browser preview, click the "Reveal code" button, and tell me the code that appears.`,
    previewPage:
      '<!doctype html><title>Reveal</title><button onclick="document.getElementById(\'code\').textContent=\'KESTREL-\'+(6000+77)">Reveal code</button><p id="code"></p>',
    grade: (outcome) => grade(usedTool(outcome, PREVIEW) && answerMatches(outcome, /KESTREL-6077/), 'preview used; clicks and reads the code'),
    reference: { answer: 'KESTREL-6077', toolNames: ['preview_click'] },
  },
]
