import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  InputEvent,
} from '@mariozechner/pi-coding-agent'
import type { WaggleConfig } from '@openwaggle/waggle-core'
import type { DefaultPiWaggleRunState } from './default-run'

export type SetDefaultPiWaggleRun = (run: DefaultPiWaggleRunState | null) => void

export type StartDefaultPiWaggleRun = (input: {
  readonly pi: Pick<ExtensionAPI, 'sendMessage' | 'sendUserMessage' | 'setModel'>
  readonly ctx: ExtensionContext
  readonly config: WaggleConfig
  readonly prompt: string
  readonly images?: InputEvent['images']
  readonly setActiveRun: SetDefaultPiWaggleRun
  readonly dispatchPrompt?: boolean
}) => Promise<void>

export type DefaultWaggleCommandPi = Pick<
  ExtensionAPI,
  'appendEntry' | 'sendMessage' | 'sendUserMessage' | 'setModel'
>

export interface DefaultWaggleCommandInput {
  readonly pi: DefaultWaggleCommandPi
  readonly ctx: ExtensionCommandContext
  readonly setActiveRun: SetDefaultPiWaggleRun
  readonly startRun: StartDefaultPiWaggleRun
}
