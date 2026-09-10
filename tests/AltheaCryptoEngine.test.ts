import { describe, expect, it } from 'vitest';
import { AltheaCryptoEngine } from '../services/AltheaCryptoEngine';

describe('IARA cryptographic integrity', () => {
  const masterKey = 'althea-test-master-key-with-at-least-32-bytes-entropy';
  const tenantA = 'tenant-a';
  const tenantB = 'tenant-b';
  const engine = new AltheaCryptoEngine(masterKey);

  it('round-trips the exact plaintext and produces independent randomized packages', () => {
    const plaintext = JSON.stringify({
      clientName: 'Test Client',
      clientPhone: '+5511000000000',
      purpose: 'iara-memory-test',
    });

    const first = engine.encryptPayload(plaintext, tenantA);
    const second = engine.encryptPayload(plaintext, tenantA);

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    expect(first.tenantSalt).not.toBe(second.tenantSalt);
    expect(engine.decryptPayload(first, tenantA)).toBe(plaintext);
    expect(engine.decryptPayload(second, tenantA)).toBe(plaintext);
  });

  it('cryptographically binds ciphertext to its tenant context', () => {
    const plaintext = JSON.stringify({ value: 'tenant-isolation' });
    const encrypted = engine.encryptPayload(plaintext, tenantA);

    expect(() => engine.decryptPayload(encrypted, tenantB)).toThrow(
      '[CRYPTO_INTEGRITY_VIOLATION]',
    );
  });

  it('rejects tampered ciphertext and authentication tags', () => {
    const encrypted = engine.encryptPayload('integrity-check', tenantA);

    const tamperedCiphertext = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -2)}00`,
    };
    const tamperedTag = {
      ...encrypted,
      authTag: `${encrypted.authTag.slice(0, -2)}00`,
    };

    expect(() => engine.decryptPayload(tamperedCiphertext, tenantA)).toThrow(
      '[CRYPTO_INTEGRITY_VIOLATION]',
    );
    expect(() => engine.decryptPayload(tamperedTag, tenantA)).toThrow(
      '[CRYPTO_INTEGRITY_VIOLATION]',
    );
  });

  it('rejects malformed package metadata before returning plaintext', () => {
    const encrypted = engine.encryptPayload('metadata-check', tenantA);

    expect(() =>
      engine.decryptPayload({ ...encrypted, version: 999 as typeof encrypted.version }, tenantA),
    ).toThrow('[CRYPTO_INTEGRITY_VIOLATION]');

    expect(() =>
      engine.decryptPayload({ ...encrypted, iv: '00' }, tenantA),
    ).toThrow('[CRYPTO_INTEGRITY_VIOLATION]');
  });

  it('rejects insufficient master keys at construction time', () => {
    expect(() => new AltheaCryptoEngine('too-short')).toThrow('[CRYPTO_CONFIG_ERROR]');
  });
});
