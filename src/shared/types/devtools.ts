export interface DevtoolsEventBusConfig {
  readonly enabled: boolean
  readonly host: string
  readonly port: number
  readonly protocol: 'http' | 'https'
}
