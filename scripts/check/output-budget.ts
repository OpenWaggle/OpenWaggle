/**
 * Runs a check gate and counts the o200k tokens it prints, against a ratchet budget: agents read
 * this output on every run, so a green gate must stay one short line.
 *
 *   bun scripts/check/output-budget.ts [check|verify] [runner options...]
 *
 * The gate's own output is passed through unchanged. A green run whose output exceeds the budget in
 * scripts/check/output-budget.json fails; a failed gate keeps its exit code (failure output is
 * bounded by the runner's caps instead). The budget is a ratchet like the first-turn prefix budget
 * (scripts/perf/first-turn-prefix): lower it when the output shrinks; raising it needs a reason in
 * the pull request. The measurement goes to .tmp/check/output-tokens.json for the CI job summary.
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { countO200kTokens } from '../perf/first-turn-prefix/prefix-tokens'
import { CHECK_OUTPUT_DIRECTORY } from './report'

const BUDGET_FILE = path.join(import.meta.dirname, 'output-budget.json')
export const OUTPUT_TOKENS_FILE = `${CHECK_OUTPUT_DIRECTORY}/output-tokens.json`
const SCRIPT_ARGUMENTS_START = 2
const JSON_INDENT = 2
/** A budget this far above the measurement should be lowered. */
const SLACK_TOKENS = 8

async function readBudgets() {
  const parsed: unknown = JSON.parse(await readFile(BUDGET_FILE, 'utf8'))
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`${BUDGET_FILE} is not an object`)
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  )
}

/** Runs the gate, echoing its output, and returns the exit code and everything it printed. */
function runGate(args: readonly string[]) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, 'run.ts'), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: string[] = []
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      chunks.push(chunk)
      process.stdout.write(chunk)
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      chunks.push(chunk)
      process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, output: chunks.join('') }))
  })
}

export function budgetVerdict(
  gate: string,
  tokens: number,
  budget: number | undefined,
  passed: boolean,
) {
  if (!passed) {
    return {
      ok: true,
      message: `output-budget: ${gate} failed with ${tokens} o200k tokens of output`,
    }
  }
  if (budget === undefined) {
    return {
      ok: false,
      message: `output-budget: no budget for "${gate}" in scripts/check/output-budget.json`,
    }
  }
  if (tokens > budget) {
    return {
      ok: false,
      message: `output-budget: green ${gate} printed ${tokens} o200k tokens, over its budget of ${budget}. Keep green output to the runner's one summary line.`,
    }
  }
  const lower =
    tokens + SLACK_TOKENS < budget ? `; lower the budget to ${tokens + SLACK_TOKENS}` : ''
  return { ok: true, message: `output-budget: ${gate} ${tokens}/${budget} o200k tokens${lower}` }
}

async function main(args: readonly string[]) {
  const gate = args.find((argument) => !argument.startsWith('--')) ?? 'check'
  const { code, output } = await runGate(args)
  const tokens = countO200kTokens(output)
  const budgets = await readBudgets()
  const verdict = budgetVerdict(gate, tokens, budgets[gate], code === 0)
  await writeFile(
    OUTPUT_TOKENS_FILE,
    `${JSON.stringify({ gate, tokens, budget: budgets[gate] ?? null, passed: code === 0 }, null, JSON_INDENT)}\n`,
  )
  console.log(verdict.message)
  if (code !== 0) return code
  return verdict.ok ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(SCRIPT_ARGUMENTS_START)).then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      console.error(`output-budget: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    },
  )
}
