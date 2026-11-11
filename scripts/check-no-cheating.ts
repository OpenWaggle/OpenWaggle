/**
 * `bun scripts/check-no-cheating.ts [--base <ref>]`, the `no-cheating` check step: fails when the
 * working tree checks less than the merge base with origin/main. It prints one
 * `file:line [ID] message` line per finding and nothing when clean, and it never asks anything.
 * In CI a missing origin/main is an error, so the step cannot pass by comparing with HEAD.
 */
import { pathToFileURL } from 'node:url'
import { formatFinding } from './no-cheating/findings'
import { noCheatingFindings } from './no-cheating/run'
import { gitOrUndefined, parseBaseArgument, resolveBase } from './support/git-base'

const FIRST_ARGUMENT = 2

export async function main(argv: readonly string[]) {
  const root = (await gitOrUndefined(process.cwd(), ['rev-parse', '--show-toplevel'])) ?? '.'
  const requested = parseBaseArgument(argv)
  const base = await resolveBase(root, requested, 'no-cheating')
  if (base === 'HEAD' && requested === undefined && process.env['CI'] !== undefined) {
    console.log('no-cheating: origin/main is missing; fetch it (actions/checkout fetch-depth: 0)')
    return 1
  }
  const findings = await noCheatingFindings(root, base)
  for (const finding of findings) console.log(formatFinding(finding))
  return findings.length > 0 ? 1 : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(FIRST_ARGUMENT))
}
