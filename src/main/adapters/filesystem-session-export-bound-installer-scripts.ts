export const DARWIN_BOUND_INSTALL = `
set -eu
actual_directory=$(/usr/bin/stat -f '%d:%i' .)
[ "$actual_directory" = "$3" ] || exit 73
actual_source=$(/usr/bin/stat -f '%d:%i' "$1")
[ "$actual_source" = "$4" ] || exit 74
/usr/bin/printf ready
IFS= read -r _
if [ "$5" = "overwrite" ]; then
  /bin/mv -f "./$1" "./$2"
else
  /bin/ln -h -- "$1" "$2"
  /bin/rm -- "$1"
fi
`

export const LINUX_BOUND_INSTALL = `
set -eu
actual_directory=$(/usr/bin/stat -c '%d:%i' .)
[ "$actual_directory" = "$3" ] || exit 73
actual_source=$(/usr/bin/stat -c '%d:%i' -- "$1")
[ "$actual_source" = "$4" ] || exit 74
/usr/bin/printf ready
IFS= read -r _
if [ "$5" = "overwrite" ]; then
  /bin/mv -f "./$1" "./$2"
else
  /bin/ln -T -- "$1" "$2"
  /bin/rm -- "$1"
fi
`

export const NODE_BOUND_COPY_INSTALL = `
const crypto = require('node:crypto')
const fs = require('node:fs')
const [pendingName, destinationName, expectedDirectory, expectedDigest, mode] = process.argv.slice(1)
const directory = fs.statSync('.', { bigint: true })
if (String(directory.dev) + ':' + String(directory.ino) !== expectedDirectory) process.exit(73)
process.stdout.write('ready')
process.stdin.once('data', () => {
  let pendingFd
  let pendingIdentity
  try {
    pendingFd = fs.openSync(
      pendingName,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW | fs.constants.O_RDWR,
      0o600,
    )
    pendingIdentity = fs.fstatSync(pendingFd, { bigint: true })
    const digest = crypto.createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    while (true) {
      const bytesRead = fs.readSync(3, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      digest.update(buffer.subarray(0, bytesRead))
      let offset = 0
      while (offset < bytesRead) {
        offset += fs.writeSync(pendingFd, buffer, offset, bytesRead - offset)
      }
    }
    fs.fsyncSync(pendingFd)
    if (digest.digest('hex') !== expectedDigest) throw new Error('artifact digest mismatch')
    const namedIdentity = fs.statSync(pendingName, { bigint: true })
    if (pendingIdentity.dev !== namedIdentity.dev || pendingIdentity.ino !== namedIdentity.ino) {
      throw new Error('pending artifact identity changed')
    }
    if (mode === 'overwrite') {
      fs.renameSync(pendingName, destinationName)
    } else {
      fs.linkSync(pendingName, destinationName)
      fs.unlinkSync(pendingName)
    }
  } finally {
    if (pendingFd !== undefined) fs.closeSync(pendingFd)
    try {
      const namedIdentity = fs.lstatSync(pendingName, { bigint: true })
      if (
        pendingIdentity &&
        pendingIdentity.dev === namedIdentity.dev &&
        pendingIdentity.ino === namedIdentity.ino
      ) {
        fs.unlinkSync(pendingName)
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
    }
  }
})
`
