import type { FirstPartyDocsTopicSummary, FirstPartyDocTopic } from '@shared/types/docs'
import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'
import type { DocsBundleError } from '../errors'

export interface LoadedDocsBundle {
  readonly bundlePath: string
  readonly generatedAt: string
  readonly topics: readonly FirstPartyDocsTopicSummary[]
}

export interface DocsBundleServiceShape {
  readonly getBundlePath: () => EffectType<string>
  readonly loadBundle: () => EffectType<LoadedDocsBundle, DocsBundleError>
  readonly listTopics: () => EffectType<readonly FirstPartyDocsTopicSummary[], DocsBundleError>
  readonly resolveTopic: (
    topic: FirstPartyDocTopic,
  ) => EffectType<FirstPartyDocsTopicSummary | null, DocsBundleError>
}

export class DocsBundleService extends Context.Tag('@openwaggle/DocsBundleService')<
  DocsBundleService,
  DocsBundleServiceShape
>() {}
