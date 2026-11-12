import childProcess from 'node:child_process'
import cluster from 'node:cluster'
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import http2 from 'node:http2'
import { syncBuiltinESMExports } from 'node:module'
import workerThreads from 'node:worker_threads'
import { installTrustedMainDnsNetworkEscapeGuard } from './trusted-main-network-dns-escape-guard'
import {
  callablePatch,
  prototypeMethodPatch,
  superclassPatch,
  type TrustedMainNetworkEscapeGuard,
  type TrustedMainNetworkEscapePatchInstaller,
} from './trusted-main-network-escape-guard-model'

const CHILD_PROCESS_REASON =
  'Child processes can bypass declared network origins and trusted main network guards.'
const CLUSTER_REASON = 'Cluster workers can bypass trusted main network guards.'
const HTTP2_REASON = 'HTTP/2 clients are not permitted by extension network origin policy.'
const UDP_REASON = 'UDP sockets are not permitted by extension network origin policy.'
const WORKER_REASON = 'Worker threads can bypass trusted main network guards in a fresh isolate.'

const ESCAPE_PATCH_INSTALLERS = [
  callablePatch({
    target: childProcess,
    propertyName: 'exec',
    original: childProcess.exec,
    api: 'node:child_process.exec',
    reason: CHILD_PROCESS_REASON,
  }),
  callablePatch({
    target: childProcess,
    propertyName: 'execFile',
    original: childProcess.execFile,
    api: 'node:child_process.execFile',
    reason: CHILD_PROCESS_REASON,
  }),
  callablePatch({
    target: childProcess,
    propertyName: 'execFileSync',
    original: childProcess.execFileSync,
    api: 'node:child_process.execFileSync',
    reason: CHILD_PROCESS_REASON,
  }),
  callablePatch({
    target: childProcess,
    propertyName: 'execSync',
    original: childProcess.execSync,
    api: 'node:child_process.execSync',
    reason: CHILD_PROCESS_REASON,
  }),
  callablePatch({
    target: childProcess,
    propertyName: 'fork',
    original: childProcess.fork,
    api: 'node:child_process.fork',
    reason: CHILD_PROCESS_REASON,
  }),
  callablePatch({
    target: childProcess,
    propertyName: 'spawn',
    original: childProcess.spawn,
    api: 'node:child_process.spawn',
    reason: CHILD_PROCESS_REASON,
  }),
  callablePatch({
    target: childProcess,
    propertyName: 'spawnSync',
    original: childProcess.spawnSync,
    api: 'node:child_process.spawnSync',
    reason: CHILD_PROCESS_REASON,
  }),
  prototypeMethodPatch({
    target: cluster,
    propertyName: 'fork',
    api: 'node:cluster.fork',
    reason: CLUSTER_REASON,
  }),
  callablePatch({
    target: dgram,
    propertyName: 'createSocket',
    original: dgram.createSocket,
    api: 'node:dgram.createSocket',
    reason: UDP_REASON,
  }),
  callablePatch({
    target: http2,
    propertyName: 'connect',
    original: http2.connect,
    api: 'node:http2.connect',
    reason: HTTP2_REASON,
  }),
  // Shared by every import style on Node and Bun. `spawn`, `exec`, `execFile`, `fork` and
  // `cluster.fork` create their process through it; the module patches above add the synchronous
  // functions, which Node resolves through the module object and Bun through `Bun.spawnSync`.
  prototypeMethodPatch({
    target: childProcess.ChildProcess.prototype,
    propertyName: 'spawn',
    api: 'node:child_process.ChildProcess.spawn',
    reason: CHILD_PROCESS_REASON,
  }),
  prototypeMethodPatch({
    target: dgram.Socket.prototype,
    propertyName: 'bind',
    api: 'node:dgram.Socket.bind',
    reason: UDP_REASON,
  }),
  prototypeMethodPatch({
    target: dgram.Socket.prototype,
    propertyName: 'connect',
    api: 'node:dgram.Socket.connect',
    reason: UDP_REASON,
  }),
  prototypeMethodPatch({
    target: dgram.Socket.prototype,
    propertyName: 'send',
    api: 'node:dgram.Socket.send',
    reason: UDP_REASON,
  }),
  superclassPatch({
    derived: workerThreads.Worker,
    base: EventEmitter,
    api: 'node:worker_threads.Worker',
    reason: WORKER_REASON,
  }),
] satisfies readonly TrustedMainNetworkEscapePatchInstaller[]

export function installTrustedMainNetworkEscapeGuard(input: TrustedMainNetworkEscapeGuard) {
  for (const installPatch of ESCAPE_PATCH_INSTALLERS) {
    installPatch(input)
  }
  installTrustedMainDnsNetworkEscapeGuard(input)

  syncBuiltinESMExports()
}
