import type { JsonValue } from './json'

export interface ExtensionFrameRegisterInput {
  readonly frameId: string
  readonly bootstrapUrl: string
  readonly networkOrigins?: readonly string[]
}

export interface ExtensionFrameRegisterResult {
  readonly frameUrl: string
  readonly registrationId: string
}

export interface ExtensionFrameUnregisterInput {
  readonly frameId: string
  readonly registrationId: string
}

export interface ExtensionFrameMountContext {
  readonly extension: {
    readonly id: string
    readonly name: string
    readonly version: string
  }
  readonly contribution: {
    readonly id: string
    readonly title: string
    readonly family: string
  }
  readonly surface: {
    readonly family: string
    readonly execution: string
    readonly payload?: JsonValue
  }
  readonly packagePath: string
  readonly projectPaths: readonly string[]
  readonly theme: {
    readonly colorScheme: 'dark'
  }
}

export interface ExtensionFrameConfig {
  readonly moduleUrl: string
  readonly context: ExtensionFrameMountContext
}
