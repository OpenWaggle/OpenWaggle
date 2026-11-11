import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import type { Pointer } from 'bun:ffi'
import type { PtyKernelProcessInfo } from '../terminal-pty-backend'
import {
  type Ffi,
  MAX_LISTED_PIDS,
  type PlatformKernel,
  type ProcessRead,
  SIGNAL_RESULT,
  type SignalResult,
} from './posix-kernel-types'

/**
 * Linux process identity through `/proc` and pidfds (ADR 0030): `/proc/<pid>/stat` gives the
 * start time in clock ticks since boot (the identity, with the boot id); signals go through a
 * pidfd opened before the identity is checked again, so a recycled pid is never signaled.
 */
const LINUX_LIBC = 'libc.so.6'
const LINUX_PIDFD_OPEN = 434n
const LINUX_PIDFD_SEND_SIGNAL = 424n
const LINUX_STAT_FIELDS = {
  state: 0,
  ppid: 1,
  pgrp: 2,
  ttyNr: 4,
  tpgid: 5,
  startTime: 19,
} as const
const LINUX_TTY_MAJOR_SHIFT = 8
const LINUX_TTY_MAJOR_MASK = 0xfff
const LINUX_TTY_MINOR_LOW_MASK = 0xff
const LINUX_TTY_MINOR_HIGH_SHIFT = 12
const LINUX_TTY_MINOR_HIGH_MASK = 0xfff00
const DECIMAL = 10

function linuxTtyIdentity(ttyNr: number) {
  if (ttyNr === 0) return null
  const major = (ttyNr >> LINUX_TTY_MAJOR_SHIFT) & LINUX_TTY_MAJOR_MASK
  const minor =
    (ttyNr & LINUX_TTY_MINOR_LOW_MASK) |
    ((ttyNr >> LINUX_TTY_MINOR_HIGH_SHIFT) & LINUX_TTY_MINOR_HIGH_MASK)
  return `linux:${String(major)}:${String(minor)}`
}

/** `/proc/<pid>/stat`, split after the parenthesized command name, which may hold spaces. */
export function parseLinuxStat(
  stat: string,
  bootId: string,
  pid: number,
): PtyKernelProcessInfo | null {
  const open = stat.indexOf('(')
  const close = stat.lastIndexOf(')')
  if (open === -1 || close < open) return null
  // The fields start after the closing parenthesis and its space.
  const fields = stat.slice(close + ') '.length).split(' ')
  const number = (index: number) => Number.parseInt(fields[index] ?? '', DECIMAL)
  const startTime = fields[LINUX_STAT_FIELDS.startTime]
  if (startTime === undefined || !/^\d+$/u.test(startTime)) return null
  const name = stat.slice(open + 1, close)
  return {
    pid,
    startedAt: `linux:${bootId}:${startTime}`,
    ppid: number(LINUX_STAT_FIELDS.ppid),
    pgid: number(LINUX_STAT_FIELDS.pgrp),
    tpgid: number(LINUX_STAT_FIELDS.tpgid),
    ttyIdentity: linuxTtyIdentity(number(LINUX_STAT_FIELDS.ttyNr)),
    zombie: fields[LINUX_STAT_FIELDS.state] === 'Z',
    name: name.length > 0 ? name : '?',
  }
}

function isMissing(error: unknown) {
  const code: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : null
  return code === 'ENOENT' || code === 'ESRCH'
}

export function linuxKernel(ffi: Ffi): PlatformKernel {
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
  const libc = ffi.dlopen(LINUX_LIBC, {
    syscall: { args: ['i64', 'i64', 'i64', 'ptr', 'u32'], returns: 'i64' },
    close: { args: ['i32'], returns: 'i32' },
  })
  const read = (pid: number): ProcessRead => {
    try {
      const uid = statSync(`/proc/${String(pid)}`).uid
      const info = parseLinuxStat(readFileSync(`/proc/${String(pid)}/stat`, 'utf8'), bootId, pid)
      return info ? { status: 'found', info, uid } : { status: 'error' }
    } catch (error) {
      return isMissing(error) ? { status: 'absent' } : { status: 'error' }
    }
  }
  const nullPointer: Pointer | null = null
  const signal = (pid: number, identity: string, signalNumber: number): SignalResult => {
    const pidfd = Number(libc.symbols.syscall(LINUX_PIDFD_OPEN, BigInt(pid), 0n, nullPointer, 0))
    if (pidfd < 0) {
      return read(pid).status === 'absent' ? SIGNAL_RESULT.absent : SIGNAL_RESULT.failed
    }
    try {
      // The pidfd pins the process; its identity is checked after opening it.
      const current = read(pid)
      if (current.status === 'absent') return SIGNAL_RESULT.absent
      if (current.status === 'error') return SIGNAL_RESULT.failed
      if (current.info.startedAt !== identity) return SIGNAL_RESULT.mismatch
      const sent = libc.symbols.syscall(
        LINUX_PIDFD_SEND_SIGNAL,
        BigInt(pidfd),
        BigInt(signalNumber),
        nullPointer,
        0,
      )
      if (sent === 0n) return SIGNAL_RESULT.signaled
      return read(pid).status === 'absent' ? SIGNAL_RESULT.absent : SIGNAL_RESULT.failed
    } finally {
      libc.symbols.close(pidfd)
    }
  }
  const listPids = () => {
    try {
      return readdirSync('/proc')
        .filter((entry) => /^\d+$/u.test(entry))
        .map((entry) => Number.parseInt(entry, DECIMAL))
        .slice(0, MAX_LISTED_PIDS)
    } catch {
      return null
    }
  }
  const ttyPath = (pid: number) => {
    try {
      const target = readlinkSync(`/proc/${String(pid)}/fd/0`)
      return target.startsWith('/dev/') ? target : null
    } catch {
      return null
    }
  }
  return { read, signal, listPids, ttyPath }
}
