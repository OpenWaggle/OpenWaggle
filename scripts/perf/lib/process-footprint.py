#!/usr/bin/env python3
"""Physical footprint, resident size, CPU time and wakeups of macOS processes (libproc).

Usage: process-footprint.py <pid> [<pid> ...]
Prints one JSON object: {"<pid>": {"footprint": bytes, "resident": bytes, "cpuNs": n, "wakeups": n}}.
Activity Monitor's "Memory" column is the physical footprint, which is what the memory gates use.
"""
import ctypes
import json
import sys

RUSAGE_INFO_V2 = 2
# Mach absolute time on Apple silicon ticks at 24 MHz: 125/3 ns per tick.
NANOSECONDS_PER_TICK = 125 / 3


class RusageInfoV2(ctypes.Structure):
    _fields_ = [
        ("ri_uuid", ctypes.c_uint8 * 16),
        ("ri_user_time", ctypes.c_uint64),
        ("ri_system_time", ctypes.c_uint64),
        ("ri_pkg_idle_wkups", ctypes.c_uint64),
        ("ri_interrupt_wkups", ctypes.c_uint64),
        ("ri_pageins", ctypes.c_uint64),
        ("ri_wired_size", ctypes.c_uint64),
        ("ri_resident_size", ctypes.c_uint64),
        ("ri_phys_footprint", ctypes.c_uint64),
        ("ri_proc_start_abstime", ctypes.c_uint64),
        ("ri_proc_exit_abstime", ctypes.c_uint64),
        ("ri_child_user_time", ctypes.c_uint64),
        ("ri_child_system_time", ctypes.c_uint64),
        ("ri_child_pkg_idle_wkups", ctypes.c_uint64),
        ("ri_child_interrupt_wkups", ctypes.c_uint64),
        ("ri_child_pageins", ctypes.c_uint64),
        ("ri_child_elapsed_abstime", ctypes.c_uint64),
        ("ri_diskio_bytesread", ctypes.c_uint64),
        ("ri_diskio_byteswritten", ctypes.c_uint64),
    ]


def sample(library, pid):
    info = RusageInfoV2()
    if library.proc_pid_rusage(pid, RUSAGE_INFO_V2, ctypes.byref(info)) != 0:
        return None
    return {
        "footprint": info.ri_phys_footprint,
        "resident": info.ri_resident_size,
        "cpuNs": round((info.ri_user_time + info.ri_system_time) * NANOSECONDS_PER_TICK),
        "wakeups": info.ri_pkg_idle_wkups + info.ri_interrupt_wkups,
    }


def main():
    library = ctypes.CDLL("/usr/lib/libproc.dylib")
    result = {}
    for argument in sys.argv[1:]:
        value = sample(library, int(argument))
        if value is not None:
            result[argument] = value
    print(json.dumps(result))


if __name__ == "__main__":
    main()
