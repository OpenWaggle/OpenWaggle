import { match } from '@diegogbrisa/ts-match'
import type { ProjectTaskReference } from '../types/action-definitions'

/** The displayed invocation and the Host must use the same runner arguments. */
export function projectTaskArguments(reference: ProjectTaskReference): readonly string[] {
  return match(reference.provider)
    .with('package-script', () => ['run', reference.task])
    .with('hatch-script', () => ['run', `${reference.environment ?? 'default'}:${reference.task}`])
    .with('cargo-alias', () => [reference.task])
    .exhaustive()
}
