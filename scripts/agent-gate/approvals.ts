/**
 * Changes that need the user's word: an added dependency (DEP-02). A weaker tsconfig is never
 * allowed (TS-01), so the gate blocks it without asking. Right after the tool call that made one, the gate asks, which pauses the Session until the user
 * answers; the answer is kept for the rest of the Session. A package named in one of the user's
 * prompts counts as approved. Without a UI nothing is asked and the gate blocks instead.
 */
import { type ManifestPin, changedPins, manifestPins } from '../dependency-pins/pins'
import { addedPins } from './dependencies'
import type { Baseline } from './baseline'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Asks the user; undefined when there is no UI to ask with. */
export type ApprovalAsk = (title: string, message: string) => Promise<boolean | undefined>

const MANIFEST = /(?:^|\/)package\.json$/u

function dependencyKey(pin: ManifestPin) {
  return `dependency ${pin.manifest} ${pin.package}@${pin.spec}`
}

export class Approvals {
  private readonly answers = new Map<string, boolean>()
  private readonly prompts: string[] = []

  private readonly ask: ApprovalAsk | undefined

  constructor(ask: ApprovalAsk | undefined) {
    this.ask = ask
  }

  notePrompt(text: string) {
    this.prompts.push(text)
  }

  dependencyApproved(pin: ManifestPin) {
    return (
      this.answers.get(dependencyKey(pin)) === true ||
      this.prompts.some((prompt) => prompt.includes(pin.package))
    )
  }

  /** Asks about each new approval the changed files need; a note when the user refused one. */
  async review(root: string, changed: readonly string[], baseline: Baseline) {
    const refusals: string[] = []
    for (const file of changed) {
      if (!MANIFEST.test(file)) continue
      const now = await readFile(path.join(root, file), 'utf8').catch(() => undefined)
      if (now === undefined) continue
      const before = await baseline.text(file)
      if (MANIFEST.test(file)) {
        const pins = addedPins(manifestPins(file, before ?? '{}'), manifestPins(file, now))
        for (const pin of changedPins([], pins).filter(
          (added) => !this.dependencyApproved(added),
        )) {
          const allowed = await this.decide(
            dependencyKey(pin),
            `Add ${pin.package}@${pin.spec}?`,
            `${file} ${pin.section} [DEP-02]`,
          )
          if (allowed === false) {
            refusals.push(
              `The user did not approve adding ${pin.package}; remove it from ${file} [DEP-02].`,
            )
          }
        }
      }
    }
    return refusals.length === 0 ? undefined : refusals.join('\n')
  }

  private async decide(key: string, title: string, message: string) {
    const known = this.answers.get(key)
    if (known !== undefined || this.ask === undefined) return known
    const answer = await this.ask(title, message)
    if (answer !== undefined) this.answers.set(key, answer)
    return answer
  }
}
