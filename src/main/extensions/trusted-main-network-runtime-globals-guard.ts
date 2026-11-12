const RAW_SOCKET_REASON = 'Raw sockets are not permitted by extension network origin policy.'
const UDP_REASON = 'UDP sockets are not permitted by extension network origin policy.'
const PROCESS_REASON =
  'Child processes can bypass declared network origins and trusted main network guards.'
const SCHEDULED_JOB_REASON =
  'Scheduled system jobs run outside the process and its trusted main network guards.'
const CLIENT_REASON = 'Database, Redis and S3 clients connect outside the declared HTTPS origins.'
const DNS_REASON = 'Direct DNS resolution can bypass declared network origins.'
const WEBSOCKET_REASON = 'WebSocket clients are not permitted by extension network origin policy.'
const EVENT_SOURCE_REASON =
  'EventSource clients are not permitted by extension network origin policy.'
const WORKER_REASON = 'Worker threads can bypass trusted main network guards in a fresh isolate.'
const S3_URL_PATTERN = /^s3:/iu

/**
 * Bun APIs that reach the network or start code outside this process, guarded on the `Bun`
 * object. `import { connect } from 'bun'` reads the same object, so this covers named imports.
 * `Bun.fetch` is absent: it is a read-only, non-configurable property, so no code can wrap it
 * (see the residual risks in the trusted main runtime docs).
 */
const BUN_GUARDED_PROPERTIES = [
  ['connect', RAW_SOCKET_REASON],
  ['udpSocket', UDP_REASON],
  ['spawn', PROCESS_REASON],
  ['spawnSync', PROCESS_REASON],
  ['$', PROCESS_REASON],
  ['openInEditor', PROCESS_REASON],
  ['cron', SCHEDULED_JOB_REASON],
  ['SQL', CLIENT_REASON],
  ['sql', CLIENT_REASON],
  ['postgres', CLIENT_REASON],
  ['RedisClient', CLIENT_REASON],
  ['redis', CLIENT_REASON],
  ['S3Client', CLIENT_REASON],
  ['s3', CLIENT_REASON],
  ['FetchSession', CLIENT_REASON],
] as const

/** `Bun.file` and `Bun.write` read and write S3 objects when given an `s3://` URL. */
const BUN_S3_URL_PROPERTIES = ['file', 'write'] as const

/** `Bun.dns.lookup` passes for the host an allowed HTTPS request connects to. */
const BUN_DNS_LOOKUP_PROPERTIES = ['lookup'] as const
const BUN_DNS_RESOLVE_PROPERTIES = [
  'lookupService',
  'prefetch',
  'resolve',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
] as const

const GLOBAL_GUARDED_PROPERTIES = [
  ['WebSocket', WEBSOCKET_REASON],
  ['EventSource', EVENT_SOURCE_REASON],
  ['Worker', WORKER_REASON],
] as const

type Callable = (...args: readonly unknown[]) => unknown

export interface TrustedMainRuntimeGlobalsGuard {
  readonly enforceBlockedApi: (api: string, reason: string) => void
  readonly isAuthorizedHostname: (hostname: unknown) => boolean
}

interface GuardedValue {
  readonly guard: TrustedMainRuntimeGlobalsGuard
  readonly api: string
  readonly reason: string
  /** Whether a call with these arguments is checked. Every use is checked when absent. */
  readonly checksCall?: (args: readonly unknown[]) => boolean
}

function isCallable(value: unknown): value is Callable {
  return typeof value === 'function'
}

function isGuardable(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function isS3Url(value: unknown) {
  if (value instanceof URL) {
    return value.protocol === 's3:'
  }
  return typeof value === 'string' && S3_URL_PATTERN.test(value)
}

function enforce(input: GuardedValue, args: readonly unknown[]) {
  if (input.checksCall === undefined || input.checksCall(args)) {
    input.guard.enforceBlockedApi(input.api, input.reason)
  }
}

/**
 * Wraps a runtime value so that calling it, constructing it and reading its members fail while a
 * trusted main policy is active, and pass through otherwise. Methods read through the wrapper run
 * on the original value, which native receiver checks need.
 */
function guardedValue(target: object, input: GuardedValue) {
  const methodWrappers = new WeakMap<Callable, Callable>()
  function methodWrapper(method: Callable) {
    const existing = methodWrappers.get(method)
    if (existing) {
      return existing
    }
    function guardedMethod(this: unknown, ...args: readonly unknown[]) {
      return Reflect.apply(method, this === proxy ? target : this, args)
    }
    methodWrappers.set(method, guardedMethod)
    return guardedMethod
  }

  const proxy: object = new Proxy(target, {
    apply(callable, thisArgument: unknown, args: unknown[]) {
      enforce(input, args)
      if (!isCallable(callable)) {
        throw new TypeError(`${input.api} is not a function.`)
      }
      return Reflect.apply(callable, thisArgument, args)
    },
    construct(constructable, args: unknown[], newTarget) {
      enforce(input, args)
      if (!isCallable(constructable)) {
        throw new TypeError(`${input.api} is not a constructor.`)
      }
      const instance: unknown = Reflect.construct(constructable, args, newTarget)
      if (!isGuardable(instance)) {
        throw new TypeError(`${input.api} did not construct an object.`)
      }
      return instance
    },
    get(object, property) {
      if (input.checksCall === undefined) {
        enforce(input, [])
      }
      const value: unknown = Reflect.get(object, property)
      return isCallable(value) && property !== 'prototype' ? methodWrapper(value) : value
    },
  })
  return proxy
}

function guardProperty(target: object, propertyName: string, input: GuardedValue) {
  const value: unknown = Reflect.get(target, propertyName)
  if (!isGuardable(value)) {
    return
  }
  Reflect.set(target, propertyName, guardedValue(value, input))
}

function installBunGuard(bun: object, guard: TrustedMainRuntimeGlobalsGuard) {
  for (const [propertyName, reason] of BUN_GUARDED_PROPERTIES) {
    guardProperty(bun, propertyName, { guard, api: `Bun.${propertyName}`, reason })
  }
  for (const propertyName of BUN_S3_URL_PROPERTIES) {
    guardProperty(bun, propertyName, {
      guard,
      api: `Bun.${propertyName}`,
      reason: CLIENT_REASON,
      checksCall: (args) => isS3Url(args[0]),
    })
  }

  const dns = 'dns' in bun ? bun.dns : undefined
  if (!isGuardable(dns)) {
    return
  }
  for (const propertyName of BUN_DNS_LOOKUP_PROPERTIES) {
    guardProperty(dns, propertyName, {
      guard,
      api: `Bun.dns.${propertyName}`,
      reason: DNS_REASON,
      checksCall: (args) => !guard.isAuthorizedHostname(args[0]),
    })
  }
  for (const propertyName of BUN_DNS_RESOLVE_PROPERTIES) {
    guardProperty(dns, propertyName, {
      guard,
      api: `Bun.dns.${propertyName}`,
      reason: DNS_REASON,
      checksCall: () => true,
    })
  }
}

interface RuntimeGlobals {
  readonly globals: object
  readonly bun: unknown
}

function currentRuntimeGlobals() {
  const globals: object = globalThis
  const result: RuntimeGlobals = { globals, bun: 'Bun' in globals ? globals.Bun : undefined }
  return result
}

/**
 * Guards the runtime globals that reach the network without a Node builtin: Web `WebSocket`,
 * `EventSource` and `Worker` where the runtime has them, and the Bun APIs on Bun.
 */
export function installTrustedMainRuntimeGlobalsGuard(
  guard: TrustedMainRuntimeGlobalsGuard,
  runtime: RuntimeGlobals = currentRuntimeGlobals(),
) {
  for (const [propertyName, reason] of GLOBAL_GUARDED_PROPERTIES) {
    guardProperty(runtime.globals, propertyName, {
      guard,
      api: propertyName,
      reason,
      checksCall: () => true,
    })
  }

  if (isGuardable(runtime.bun)) {
    installBunGuard(runtime.bun, guard)
  }
}
