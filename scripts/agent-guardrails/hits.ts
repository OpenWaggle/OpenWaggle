/** What one guardrail rule reports for one command or file change. */
export type GuardrailRule =
  | 'git-no-verify'
  | 'husky-off'
  | 'hooks-path'
  | 'hook-files'
  | 'git-config-file'
  | 'force-push'
  | 'unreadable-script'

export interface GuardrailHit {
  readonly rule: GuardrailRule
  /** One line naming what was blocked. */
  readonly title: string
}

/** What agents should do instead of skipping a hook, appended to every hook-skip block. */
export const HOOK_SKIP_GUIDANCE =
  'Agents never skip or turn off git hooks: they format staged files, check the commit message and run the fast verify. Fix what the hook reports. If the failure is outside your task, flaky, or in the infrastructure, stop and report it to the maintainer.'

export const FORCE_PUSH_GUIDANCE =
  'Force pushes rewrite published history and are blocked for agents. Push new commits on top instead (for example a merge of the base branch, or a revert). If history really must be rewritten, stop and ask the maintainer to do it.'

export const UNREADABLE_GUIDANCE =
  'The guardrail reads every command before it runs and cannot read a script piped into a shell, so it could hide a hook skip or a force push. Run the commands directly, or write the script to a file and run that file.'

export function guidanceFor(rule: GuardrailRule) {
  if (rule === 'force-push') {
    return FORCE_PUSH_GUIDANCE
  }
  return rule === 'unreadable-script' ? UNREADABLE_GUIDANCE : HOOK_SKIP_GUIDANCE
}
