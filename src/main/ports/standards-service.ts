/**
 * StandardsService port — domain-owned interface for loading agent standards and skills.
 *
 * Implemented by the filesystem adapter layer.
 */
import type { PreparedAttachment } from '@shared/types/agent'
import type { Settings } from '@shared/types/settings'
import { Context, type Effect } from 'effect'
import type { AgentStandardsContext } from '../agent/standards-context'
import type { StandardsLoadError } from '../errors'

export interface LoadStandardsOptions {
  readonly projectPath: string
  readonly userText: string
  readonly settings: Settings
  readonly attachments: readonly PreparedAttachment[]
}

export interface StandardsServiceShape {
  readonly loadContext: (
    options: LoadStandardsOptions,
  ) => Effect.Effect<AgentStandardsContext, StandardsLoadError>
}

export class StandardsService extends Context.Tag('@openwaggle/StandardsService')<
  StandardsService,
  StandardsServiceShape
>() {}
