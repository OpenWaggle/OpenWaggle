/**
 * Compares Title model output against a rubric, ported from T3 Code's
 * `apps/server/scripts/evaluate-thread-titles.ts` (MIT License) per ADR 0043.
 *
 *   pnpm evaluate:session-titles --model anthropic/claude-haiku-4-5 --out /tmp/title-eval
 *   pnpm evaluate:session-titles --model ... --out /tmp/next --baseline /tmp/title-eval/results.json
 *   pnpm evaluate:session-titles --model ... --out /tmp/first --initial
 *
 * `--initial` titles each case from its first user message only. Without it, each case is
 * regenerated from its whole history against its previous title, as Title regeneration does.
 * `review.json` lists both titles in random order for a blind comparison; `answer-key.json` says
 * which one is new.
 */
import { randomInt } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { parseModelRef } from '@shared/types/llm'
import { formatSessionTitleContext } from '../src/main/domain/session-title/session-title-context'
import { parseGeneratedSessionTitle } from '../src/main/domain/session-title/session-title-output'
import { buildSessionTitlePrompt } from '../src/main/domain/session-title/session-title-prompts'
import { SESSION_TITLE_EVALUATION_CASES } from './session-title-evaluation-cases'

const USAGE_EXIT_CODE = 2
const COIN_SIDES = 2
const JSON_INDENT = 2

interface EvaluationResult {
  readonly id: string
  readonly title: string | null
  readonly needsRefinement: boolean
  readonly latencyMs: number
}

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    out: { type: 'string' },
    baseline: { type: 'string' },
    initial: { type: 'boolean', default: false },
  },
})

if (!values.model || !parseModelRef(values.model) || !values.out) {
  process.stderr.write('Use --model <provider/model> --out <directory> [--baseline <results.json>] [--initial]\n')
  process.exit(USAGE_EXIT_CODE)
}
const modelReference = parseModelRef(values.model)
const outputDirectory = path.resolve(values.out)

function isEvaluationResult(value: unknown): value is EvaluationResult {
  return typeof value === 'object' && value !== null && 'id' in value && 'title' in value
}

async function readBaseline(file: string | undefined) {
  if (!file) return []
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error(`${file} is not a results.json array.`)
  return parsed.filter(isEvaluationResult)
}

/** Mirrors the request the Pi title adapter sends: one tool-free turn, a small output budget. */
const TITLE_MAX_OUTPUT_TOKENS = 400

async function createGenerator() {
  // Pi ships ESM only, so this CommonJS script loads it dynamically, as the benchmarks do.
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
  const runtime = await ModelRuntime.create()
  const titleModel = modelReference
    ? runtime.getModel(modelReference.provider, modelReference.modelId)
    : undefined
  if (!titleModel) throw new Error(`Pi does not know the model ${values.model ?? ''}.`)
  return async (systemPrompt: string, prompt: string) => {
    const response = await runtime.completeSimple(
      titleModel,
      { systemPrompt, messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] },
      { maxTokens: Math.min(TITLE_MAX_OUTPUT_TOKENS, titleModel.maxTokens) },
    )
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throw new Error(response.errorMessage ?? `Title request ${response.stopReason}.`)
    }
    return response.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
  }
}

async function evaluateCase(
  generate: Awaited<ReturnType<typeof createGenerator>>,
  fixture: (typeof SESSION_TITLE_EVALUATION_CASES)[number],
) {
  const firstUser = fixture.messages.find((message) => message.role === 'user')
  if (!firstUser) throw new Error(`Case ${fixture.id} has no user message.`)
  const context = formatSessionTitleContext(fixture.messages)
  const prompt = values.initial
    ? buildSessionTitlePrompt({ message: firstUser.text })
    : buildSessionTitlePrompt({ message: context.message, previousTitle: fixture.previousTitle })
  const startedAt = performance.now()
  const parsed = parseGeneratedSessionTitle(await generate(prompt.systemPrompt, prompt.prompt))
  return {
    id: fixture.id,
    title: parsed?.title ?? null,
    needsRefinement: parsed?.needsRefinement ?? false,
    latencyMs: Math.round(performance.now() - startedAt),
  } satisfies EvaluationResult
}

async function main() {
  const generate = await createGenerator()
  const baseline = await readBaseline(values.baseline)
  const results: EvaluationResult[] = []
  const review: unknown[] = []
  const answerKey: unknown[] = []
  for (const fixture of SESSION_TITLE_EVALUATION_CASES) {
    const result = await evaluateCase(generate, fixture)
    const previous = baseline.find((entry) => entry.id === fixture.id)?.title ?? fixture.previousTitle
    const newFirst = randomInt(COIN_SIDES) === 0
    results.push(result)
    review.push({
      id: fixture.id,
      request: fixture.request,
      rubric: fixture.rubric,
      A: newFirst ? result.title : previous,
      B: newFirst ? previous : result.title,
      preferred: '',
    })
    answerKey.push({ id: fixture.id, candidate: newFirst ? 'A' : 'B' })
    process.stdout.write(`${fixture.id}: ${result.title ?? '(no title)'} (${result.latencyMs} ms)\n`)
  }

  await mkdir(outputDirectory, { recursive: true })
  for (const [name, report] of [
    ['results', results],
    ['review', review],
    ['answer-key', answerKey],
  ] as const) {
    await writeFile(path.join(outputDirectory, `${name}.json`), `${JSON.stringify(report, null, JSON_INDENT)}\n`)
  }
  process.stdout.write(`Wrote ${outputDirectory}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
