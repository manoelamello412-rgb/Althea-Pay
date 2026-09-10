import { describe, expect, it } from 'vitest'
import { AltheaCryptoEngine } from '../../services/AltheaCryptoEngine'

describe('IARA cryptographic boundary', () => {
  const engine = new AltheaCryptoEngine('a'.repeat(64))

  it('round-trips plaintext for the same tenant', () => {
    const encrypted = engine.encryptPayload('{"amount":100}', 'tenant-a')
    expect(engine.decryptPayload(encrypted, 'tenant-a')).toBe('{"amount":100}')
  })

  it('rejects decryption under another tenant context', () => {
    const encrypted = engine.encryptPayload('secret', 'tenant-a')
    expect(() => engine.decryptPayload(encrypted, 'tenant-b')).toThrow('CRYPTO_INTEGRITY_VIOLATION')
  })

  it('rejects tampered ciphertext', () => {
    const encrypted = engine.encryptPayload('secret', 'tenant-a')
    const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext}00` }
    expect(() => engine.decryptPayload(tampered, 'tenant-a')).toThrow('CRYPTO_INTEGRITY_VIOLATION')
  })
})
