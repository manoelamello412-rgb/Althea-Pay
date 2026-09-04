const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
])

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value << 8) | octet
  }
  return value >>> 0
}

function ipv4InRange(value: number, base: string, prefix: number): boolean {
  const baseValue = ipv4ToInt(base)
  if (baseValue === null) return true
  if (prefix === 0) return true
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return (value & mask) === (baseValue & mask)
}

function isPrivateOrReservedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip)
  if (value === null) return true
  return [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
  ].some(([base, prefix]) => ipv4InRange(value, base as string, prefix as number))
}

function normalizeIPv6(ip: string): bigint | null {
  const value = ip.toLowerCase().split('%')[0]
  const halves = value.split('::')
  if (!value || halves.length > 2) return null
  const expand = (part: string): string[] | null => {
    if (!part.includes('.')) return [part]
    const v = ipv4ToInt(part)
    if (v === null) return null
    return [((v >>> 16) & 0xffff).toString(16), (v & 0xffff).toString(16)]
  }
  const left = halves[0] ? halves[0].split(':').flatMap(expand) : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').flatMap(expand) : []
  if (!left || !right) return null
  if (halves.length === 1 && left.length !== 8) return null
  if (halves.length === 2 && left.length + right.length >= 8) return null
  const groups = [...left, ...(halves.length === 2 ? Array(8 - left.length - right.length).fill('0') : []), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  let result = 0n
  for (const group of groups) result = (result << 16n) | BigInt(parseInt(group, 16))
  return result
}

function ipv6InRange(value: bigint, base: string, prefix: number): boolean {
  const baseValue = normalizeIPv6(base)
  if (baseValue === null) return true
  return (value >> (128n - BigInt(prefix))) === (baseValue >> (128n - BigInt(prefix)))
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isPrivateOrReservedIPv4(mapped[1])
  const value = normalizeIPv6(ip)
  if (value === null) return true
  return [
    ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10],
    ['ff00::', 8], ['2001:db8::', 32], ['2001:2::', 48], ['2001:10::', 28],
  ].some(([base, prefix]) => ipv6InRange(value, base as string, prefix as number))
}

async function resolvesToPublicAddress(hostname: string): Promise<boolean> {
  const literalV4 = ipv4ToInt(hostname)
  if (literalV4 !== null) return !isPrivateOrReservedIPv4(hostname)
  if (hostname.includes(':')) return !isPrivateOrReservedIPv6(hostname)
  try {
    const [v4, v6] = await Promise.allSettled([
      Deno.resolveDns(hostname, 'A'),
      Deno.resolveDns(hostname, 'AAAA'),
    ])
    const addresses = [
      ...(v4.status === 'fulfilled' ? v4.value : []),
      ...(v6.status === 'fulfilled' ? v6.value : []),
    ]
    if (addresses.length === 0) return false
    return addresses.every((address) => address.includes(':') ? !isPrivateOrReservedIPv6(address) : !isPrivateOrReservedIPv4(address))
  } catch {
    return false
  }
}

export type SsrfGuardResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'invalid_url' | 'protocol_not_allowed' | 'target_not_allowed' }

export async function assertPublicHttpsUrl(rawUrl: string): Promise<SsrfGuardResult> {
  let url: URL
  try { url = new URL(rawUrl) } catch { return { ok: false, reason: 'invalid_url' } }
  if (url.protocol !== 'https:') return { ok: false, reason: 'protocol_not_allowed' }
  if (url.username || url.password) return { ok: false, reason: 'target_not_allowed' }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) return { ok: false, reason: 'target_not_allowed' }
  if (!(await resolvesToPublicAddress(hostname))) return { ok: false, reason: 'target_not_allowed' }
  return { ok: true, url: url.toString() }
}
