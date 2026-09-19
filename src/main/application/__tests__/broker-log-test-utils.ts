export interface CapturedLog {
  readonly namespace: string
  readonly message: string
  readonly data?: Readonly<Record<string, unknown>>
}
