import path from 'node:path'
import { Schema } from '@shared/schema'

export {
  DEFAULT_GIT_MAX_BUFFER,
  DIFF_GIT_MAX_BUFFER,
  execFileAsync,
  type GitExecResult,
  isGitRepository,
  type RunGitOptions,
  runGit,
  stripSurroundingQuotes,
} from '../../adapters/git/run-git'

export const projectPathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter((projectPath) => path.isAbsolute(projectPath) || 'Project path must be absolute'),
)

/** Empty string means "resolve the base automatically"; any string is otherwise valid. */
export const branchDiffBaseRefSchema = Schema.String
