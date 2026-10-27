import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { answerMatches, type EvalTask, grade, verificationPassed } from './evaluate-agent-context-types'

/** Core coding control and truncated tool output: tasks any coding agent must handle. */

async function files(root: string, entries: Readonly<Record<string, string>>) {
  for (const [relative, content] of Object.entries(entries)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await writeFile(path.join(root, relative), content)
  }
}

const NODE_TEST = 'node --test test/'
const SLUGIFY_CHECK = 'node check-slugify.mjs'
const RENAME_CHECK = 'node check-rename.mjs'
const GENERATED_LINES = 6_000
const NEEDLE_LINE = 4_321
const LONG_FILE_LINES = 4_000
const LONG_FILE_NEEDLE_LINE = 3_870

function generatorScript() {
  return `for (let line = 1; line <= ${String(GENERATED_LINES)}; line += 1) {\n  console.log(line === ${String(NEEDLE_LINE)} ? 'line ${String(NEEDLE_LINE)}: the release codename is OSPREY-5521' : \`line \${line}: nothing to see\`)\n}\n`
}

function longLedger() {
  return Array.from({ length: LONG_FILE_LINES }, (_, index) => {
    const line = index + 1
    return line === LONG_FILE_NEEDLE_LINE ? `${String(line)}, refund, approved by Ines Duarte, 812.40` : `${String(line)}, sale, routine entry, 10.00`
  }).join('\n')
}

export const CODING_TASKS: readonly EvalTask[] = [
  {
    id: 'core-fix-failing-test',
    group: 'core-coding',
    prompt: () => 'The unit test in test/sum.test.mjs fails. Fix the bug in src/sum.mjs (do not change the test) and confirm the test passes.',
    setup: (root) =>
      files(root, {
        'src/sum.mjs': 'export function sum(values) {\n  return values.reduce((total, value) => total - value, 0)\n}\n',
        'test/sum.test.mjs': "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\nimport { sum } from '../src/sum.mjs'\n\ntest('sums values', () => {\n  assert.equal(sum([1, 2, 3]), 6)\n})\n",
      }),
    inspectFiles: ['test/sum.test.mjs'],
    verify: [NODE_TEST],
    grade: (outcome) =>
      grade(
        verificationPassed(outcome, NODE_TEST) && (outcome.files['test/sum.test.mjs'] ?? '').includes('assert.equal(sum([1, 2, 3]), 6)'),
        'test passes and is unchanged',
      ),
    reference: {
      files: { 'test/sum.test.mjs': 'assert.equal(sum([1, 2, 3]), 6)' },
      verifications: { [NODE_TEST]: { exitCode: 0, output: '' } },
    },
  },
  {
    id: 'core-rename-function',
    group: 'core-coding',
    prompt: () => 'Rename the function `fetchUsr` to `fetchUser` everywhere in this project (definition and every call site).',
    setup: (root) =>
      files(root, {
        'src/api.mjs': "export function fetchUsr(id) {\n  return { id, name: 'Ada' }\n}\n",
        'src/profile.mjs': "import { fetchUsr } from './api.mjs'\nexport const profile = (id) => fetchUsr(id).name\n",
        'src/admin.mjs': "import { fetchUsr } from './api.mjs'\nexport const admin = () => fetchUsr(1)\n",
        'check-rename.mjs': "import { readFileSync } from 'node:fs'\nconst all = ['src/api.mjs', 'src/profile.mjs', 'src/admin.mjs'].map((f) => readFileSync(f, 'utf8')).join('\\n')\nif (all.includes('fetchUsr') || !all.includes('fetchUser')) process.exit(1)\nconst { profile } = await import('./src/profile.mjs')\nif (profile(2) !== 'Ada') process.exit(1)\n",
      }),
    verify: [RENAME_CHECK],
    grade: (outcome) => grade(verificationPassed(outcome, RENAME_CHECK), 'old name gone, code still runs'),
    reference: { verifications: { [RENAME_CHECK]: { exitCode: 0, output: '' } } },
  },
  {
    id: 'core-answer-from-code',
    group: 'core-coding',
    prompt: () => 'Which TCP port does the server in this project listen on when PORT is not set? Answer with the number.',
    setup: (root) =>
      files(root, {
        'src/config.mjs': "const DEFAULT_PORT = 8000 + 137\nexport const port = Number(process.env.PORT ?? DEFAULT_PORT)\n",
        'src/server.mjs': "import http from 'node:http'\nimport { port } from './config.mjs'\nhttp.createServer(() => {}).listen(port)\n",
      }),
    grade: (outcome) => grade(answerMatches(outcome, /\b8137\b/), 'answers 8137'),
    reference: { answer: 'It listens on port 8137.' },
  },
  {
    id: 'core-implement-spec',
    group: 'core-coding',
    prompt: () =>
      'Create src/slugify.mjs exporting `slugify(text)`: lowercase, trim, replace every run of characters that are not a-z or 0-9 with a single "-", and strip leading and trailing "-". Example: "  Hello, World!! " -> "hello-world".',
    setup: (root) =>
      files(root, {
        'check-slugify.mjs': "const { slugify } = await import('./src/slugify.mjs')\nconst cases = [['  Hello, World!! ', 'hello-world'], ['Already-ok', 'already-ok'], ['--A  B--', 'a-b'], ['Ünïcode Text', 'n-code-text']]\nfor (const [input, expected] of cases) if (slugify(input) !== expected) { console.log(input, slugify(input)); process.exit(1) }\n",
      }),
    verify: [SLUGIFY_CHECK],
    grade: (outcome) => grade(verificationPassed(outcome, SLUGIFY_CHECK), 'hidden cases pass'),
    reference: { verifications: { [SLUGIFY_CHECK]: { exitCode: 0, output: '' } } },
  },
  {
    id: 'core-edit-config',
    group: 'core-coding',
    prompt: () => 'In config/app.json, set the request timeout to 45 seconds and turn the "beta" feature flag off. Keep the rest of the file as it is.',
    setup: (root) =>
      files(root, {
        'config/app.json': `${JSON.stringify({ name: 'widgets', requestTimeoutMs: 30000, features: { beta: true, search: true } }, null, 2)}\n`,
      }),
    inspectFiles: ['config/app.json'],
    grade: (outcome) => {
      try {
        const parsed: unknown = JSON.parse(outcome.files['config/app.json'] ?? '')
        const text = JSON.stringify(parsed)
        return grade(text.includes('"requestTimeoutMs":45000') && text.includes('"beta":false') && text.includes('"search":true'), 'timeout 45000, beta off, search kept')
      } catch {
        return grade(false, 'config is not JSON')
      }
    },
    reference: { files: { 'config/app.json': '{"name":"widgets","requestTimeoutMs":45000,"features":{"beta":false,"search":true}}' } },
  },
  {
    id: 'core-shell-count',
    group: 'core-coding',
    prompt: () => 'How many lines across all .log files under logs/ (recursively) contain the word ERROR? Write just the number into answer.txt.',
    setup: (root) =>
      files(root, {
        'logs/a.log': 'INFO start\nERROR disk\nINFO ok\nERROR net\n',
        'logs/nested/b.log': 'ERROR one\nWARN two\nERROR three\nERROR four\n',
        'logs/nested/c.txt': 'ERROR not a log file\n',
      }),
    inspectFiles: ['answer.txt'],
    grade: (outcome) => grade((outcome.files['answer.txt'] ?? '').trim() === '5', 'answer.txt is 5'),
    reference: { files: { 'answer.txt': '5\n' } },
  },
  {
    id: 'truncated-bash-output',
    group: 'truncated-output',
    prompt: () => 'Run `node generate.mjs`. What is the release codename printed on line 4321 of its output?',
    setup: (root) => files(root, { 'generate.mjs': generatorScript() }),
    grade: (outcome) => grade(answerMatches(outcome, /OSPREY-5521/), 'finds the codename past the output cap'),
    reference: { answer: 'The codename is OSPREY-5521.' },
  },
  {
    id: 'truncated-long-file',
    group: 'truncated-output',
    prompt: () => 'ledger.csv is long. Who approved the only refund in it, and for what amount?',
    setup: (root) => files(root, { 'ledger.csv': `${longLedger()}\n` }),
    grade: (outcome) => grade(answerMatches(outcome, /Ines Duarte/i) && answerMatches(outcome, /812\.40/), 'finds the refund near the end'),
    reference: { answer: 'Ines Duarte approved the refund of 812.40.' },
  },
]
