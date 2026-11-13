/**
 * Checks the adapter probe's two launches (vendor/electrobun/probe, `PROBE_MODE=adapter`): the
 * second launch must read the cookie the first one set in the persist:* Browser profile, and each
 * launch must have had a DevTools port of its own.
 *
 *   bun scripts/electrobun-probe-persistence.ts <summary.json>
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { decodeUnknownOrThrow, parseJsonUnknown, Schema } from '@shared/schema'

const SummarySchema = Schema.Struct({
  runs: Schema.Array(
    Schema.Struct({
      result: Schema.Struct({
        checks: Schema.Struct({
          launchPort: Schema.NullOr(Schema.String),
          cookieValue: Schema.optional(Schema.String),
          previousLaunchCookie: Schema.optional(Schema.String),
        }),
      }),
    }),
  ),
})

export function probePersistenceProblems(summary: unknown) {
  const [first, second] = decodeUnknownOrThrow(SummarySchema, summary).runs
  if (first === undefined || second === undefined) return ['The probe needs two launches.']
  const problems: string[] = []
  const { cookieValue } = first.result.checks
  if (cookieValue === undefined) problems.push('The first launch set no cookie.')
  if (second.result.checks.previousLaunchCookie !== cookieValue) {
    problems.push(
      `The second launch read ${String(second.result.checks.previousLaunchCookie)}, not ${String(cookieValue)}.`,
    )
  }
  if (first.result.checks.launchPort === second.result.checks.launchPort) {
    problems.push(`Both launches used DevTools port ${String(first.result.checks.launchPort)}.`)
  }
  return problems
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , file] = process.argv
  if (file === undefined) throw new Error('Usage: electrobun-probe-persistence.ts <summary.json>')
  const problems = probePersistenceProblems(parseJsonUnknown(fs.readFileSync(file, 'utf8')))
  for (const problem of problems) console.error(problem)
  if (problems.length > 0) process.exitCode = 1
  else console.log('The persist:* profile kept its cookie across launches, on a new port each.')
}
