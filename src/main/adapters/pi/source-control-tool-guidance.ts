import { match } from '@diegogbrisa/ts-match'
import {
  type SourceControlAttention,
  sourceControlSignInCommand,
} from '@shared/types/source-control'

/** What the agent should do, or tell the user to do, about an attention item. */
export function attentionNextStep(attention: SourceControlAttention | null): string | null {
  if (!attention) return null
  return match(attention)
    .with(
      { kind: 'choose-provider' },
      ({ host }) =>
        `Ask the user whether ${host} runs GitHub or GitLab, then call configure with change "set-host-provider" (or "declare-project-host" to share it with the project). Use provider "unsupported" if it is neither.`,
    )
    .with(
      { kind: 'approve-declaration' },
      () =>
        'The project settings file declares source control hosts the user has not approved. Ask the user to approve them in the Session Summary.',
    )
    .with(
      { kind: 'cli-missing' },
      ({ cli, host }) =>
        `The ${cli} CLI is not installed; OpenWaggle needs it for ${host}. Ask the user to install it.`,
    )
    .with({ kind: 'not-signed-in' }, ({ provider, host, ignoredTokenVariables }) => {
      const steps = `The user must sign in to ${host}: use "Sign in" in the Session Summary, or run \`${sourceControlSignInCommand(provider, host)}\` in a terminal. Do not run the login yourself.`
      return ignoredTokenVariables.length > 0
        ? `${steps} OpenWaggle ignores the token environment variables ${ignoredTokenVariables.join(', ')}; the CLI must hold the sign-in.`
        : steps
    })
    .with(
      { kind: 'no-account-access' },
      ({ host, repository, accounts }) =>
        `None of the signed-in ${host} accounts (${accounts.join(', ') || 'none'}) can see ${repository}. The user can sign in with another account, or choose one with configure change "set-repository-account".`,
    )
    .exhaustive()
}
