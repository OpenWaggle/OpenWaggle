import { encodeUtf8 } from './http'

const BEARER = /^Bearer[ \t]+(?<token>\S+)[ \t]*$/u

async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encodeUtf8(text)))
}

/**
 * Whether an `Authorization` header carries `Bearer <expected>`. Both tokens are hashed first,
 * so the comparison takes the same time whatever the tokens' lengths or contents.
 */
export async function bearerTokenMatches(
  authorization: string | null,
  expected: string,
): Promise<boolean> {
  const token = authorization === null ? undefined : BEARER.exec(authorization)?.groups?.token
  const [provided, wanted] = await Promise.all([sha256(token ?? ''), sha256(expected)])
  let difference = 0
  for (let index = 0; index < wanted.length; index += 1) {
    difference |= (provided[index] ?? 0) ^ (wanted[index] ?? 0)
  }
  return difference === 0 && token !== undefined && expected !== ''
}
