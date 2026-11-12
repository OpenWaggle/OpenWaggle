/** Trusted main extension modules that try each egress path, for the runtime tests. */

export const RAW_SOCKET = 'Raw sockets are not permitted'
const PROCESS = 'Child processes can bypass declared network origins'
const WORKER = 'Worker threads can bypass trusted main network guards'
const UDP = 'UDP sockets are not permitted'
const DNS = 'Direct DNS resolution can bypass declared network origins'
const CLIENT = 'Database, Redis and S3 clients connect outside the declared HTTPS origins'
export const RUNS_ON_BUN = typeof Reflect.get(globalThis, 'Bun') === 'object'

export interface EgressCase {
  readonly name: string
  /** The trusted main module. `RAW_PORT` is a local TCP server that must see no connection. */
  readonly source: string
  readonly denial: string
}

export const activate = (body: string, imports = '') =>
  `${imports}
const raw = { host: '127.0.0.1', port: RAW_PORT }
const settled = (emitter) => new Promise((resolve, reject) => {
  emitter.once('error', reject)
  emitter.once('response', resolve)
})
export async function activate() {
${body}
}
`

/**
 * Every way into the guarded builtins that Bun's fixed ESM exports used to leave open, and the
 * shared prototypes below them. Each runs on Node and on Bun.
 */
export const BUILTIN_CASES: readonly EgressCase[] = [
  {
    name: 'a namespace import of node:net',
    source: activate('net.connect(raw)', "import * as net from 'node:net'"),
    denial: RAW_SOCKET,
  },
  {
    name: 'a dynamic import of node:net',
    source: activate("const { connect } = await import('node:' + 'net'); connect(raw)"),
    denial: RAW_SOCKET,
  },
  {
    name: 'net loaded through require',
    source: activate(
      "createRequire(import.meta.url)('net').connect(raw)",
      "import { createRequire } from 'node:module'",
    ),
    denial: RAW_SOCKET,
  },
  {
    name: 'a socket constructed directly',
    source: activate('new Socket().connect(raw)', "import { Socket } from 'node:net'"),
    denial: RAW_SOCKET,
  },
  {
    name: 'a named import of tls.connect',
    source: activate(
      'connect({ ...raw, rejectUnauthorized: false })',
      "import { connect } from 'node:tls'",
    ),
    denial: RAW_SOCKET,
  },
  {
    name: 'a custom http createConnection',
    source: activate(
      // The request reports a failing connection factory as an error event.
      "const req = request('http://127.0.0.1:RAW_PORT/', { createConnection: () => connect(raw) }); req.end(); await settled(req)",
      "import { request } from 'node:http'\nimport { connect } from 'node:net'",
    ),
    denial: RAW_SOCKET,
  },
  {
    name: 'a custom Node HTTP agent',
    source: activate(
      "request('https://api.github.com/', { agent: new Agent({ keepAlive: true }) }).end()",
      "import { Agent, request } from 'node:https'",
    ),
    denial: 'Custom agents can bypass the declared origin',
  },
  {
    name: 'an agent that opens its own socket',
    source: activate(
      "request('https://127.0.0.1:RAW_PORT/', { agent: { addRequest: (r) => r.onSocket(connect(raw)) } }).end()",
      "import { request } from 'node:https'\nimport { connect } from 'node:net'",
    ),
    denial: RAW_SOCKET,
  },
  {
    name: 'a namespace import of http2.connect',
    source: activate(
      "http2.connect('https://127.0.0.1:RAW_PORT')",
      "import * as http2 from 'node:http2'",
    ),
    denial: 'HTTP/2 clients are not permitted',
  },
  {
    name: 'a UDP socket constructed directly',
    source: activate(
      "new Socket('udp4').send('x', RAW_PORT, '127.0.0.1')",
      "import { Socket } from 'node:dgram'",
    ),
    denial: UDP,
  },
  {
    name: 'a named import of dns.lookup',
    source: activate(
      "await new Promise((resolve, reject) => lookup('localhost', (e) => (e ? reject(e) : resolve())))",
      "import { lookup } from 'node:dns'",
    ),
    denial: DNS,
  },
  {
    name: 'a DNS Resolver instance',
    source: activate(
      "await new Promise((resolve, reject) => new Resolver().resolve4('localhost', (e) => (e ? reject(e) : resolve())))",
      "import { Resolver } from 'node:dns'",
    ),
    denial: DNS,
  },
  {
    name: 'a child process constructed directly',
    source: activate(
      "new ChildProcess().spawn({ file: process.execPath, args: [process.execPath, '-e', ''], stdio: 'ignore' })",
      "import { ChildProcess } from 'node:child_process'",
    ),
    denial: PROCESS,
  },
  {
    name: 'a named import of child_process.exec',
    source: activate("exec('true')", "import { exec } from 'node:child_process'"),
    denial: PROCESS,
  },
  {
    name: 'a namespace import of worker_threads',
    source: activate(
      "new wt.Worker('export {}', { eval: true })",
      "import * as wt from 'node:worker_threads'",
    ),
    denial: WORKER,
  },
  {
    name: 'a Worker constructed through Reflect',
    source: activate(
      "Reflect.construct(Worker, ['export {}', { eval: true }])",
      "import { Worker } from 'node:worker_threads'",
    ),
    denial: WORKER,
  },
  {
    name: 'the global WebSocket',
    source: activate("new WebSocket('ws://127.0.0.1:RAW_PORT')"),
    denial: 'WebSocket clients are not permitted',
  },
  {
    name: 'a fetch proxy',
    source: activate(
      "await fetch('https://api.github.com', { proxy: 'http://127.0.0.1:RAW_PORT' })",
    ),
    denial: 'Fetch proxies can bypass the declared origin',
  },
  {
    name: 'a fetch Unix socket',
    source: activate(
      "await fetch('https://api.github.com', { unix: '/tmp/openwaggle-test.sock' })",
    ),
    denial: 'Unix socket paths can bypass the declared origin',
  },
]

/** APIs only Bun has. The Node run has no such globals to reach. */
export const BUN_CASES: readonly EgressCase[] = [
  {
    name: 'Bun.connect',
    source: activate(
      "await Bun.connect({ hostname: '127.0.0.1', port: RAW_PORT, socket: { data() {} } })",
    ),
    denial: RAW_SOCKET,
  },
  {
    name: 'a named import of connect from bun',
    source: activate(
      "await connect({ hostname: '127.0.0.1', port: RAW_PORT, socket: { data() {} } })",
      "import { connect } from 'bun'",
    ),
    denial: RAW_SOCKET,
  },
  { name: 'Bun.udpSocket', source: activate('await Bun.udpSocket({})'), denial: UDP },
  { name: 'Bun.spawn', source: activate("Bun.spawn(['true'])"), denial: PROCESS },
  { name: 'Bun.spawnSync', source: activate("Bun.spawnSync(['true'])"), denial: PROCESS },
  { name: 'the Bun shell', source: activate('await Bun.$`true`'), denial: PROCESS },
  { name: 'Bun.openInEditor', source: activate("Bun.openInEditor('/tmp')"), denial: PROCESS },
  {
    name: 'Bun.cron',
    source: activate("await Bun.cron('/tmp/x.ts', '* * * * *', 'x')"),
    denial: 'Scheduled system jobs',
  },
  { name: 'Bun.dns.lookup', source: activate("await Bun.dns.lookup('localhost')"), denial: DNS },
  {
    name: 'Bun.SQL',
    source: activate("new Bun.SQL('postgres://u:p@127.0.0.1:RAW_PORT/db')"),
    denial: CLIENT,
  },
  {
    name: 'Bun.RedisClient',
    source: activate("new Bun.RedisClient('redis://127.0.0.1:RAW_PORT')"),
    denial: CLIENT,
  },
  { name: 'Bun.S3Client', source: activate("new Bun.S3Client({ bucket: 'b' })"), denial: CLIENT },
  { name: 'an s3 Bun.file', source: activate("Bun.file('s3://bucket/key')"), denial: CLIENT },
  {
    name: 'the global Worker',
    source: activate("new globalThis.Worker('/tmp/x.mjs')"),
    denial: WORKER,
  },
]
