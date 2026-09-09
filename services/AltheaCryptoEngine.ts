import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const VERSION = 1 as const;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 2 * 1024 * 1024;

export interface EncryptedPackage {
  version: typeof VERSION;
  algorithm: typeof ALGORITHM;
  iv: string;
  ciphertext: string;
  authTag: string;
  tenantSalt: string;
}

function isHex(value: string): boolean {
  return value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

function decodeHex(value: string, field: string): Buffer {
  if (!isHex(value)) {
    throw new Error(`[CRYPTO_INVALID_PACKAGE] Campo ${field} não é hexadecimal válido.`);
  }
  return Buffer.from(value, 'hex');
}

function assertTenantId(tenantId: string): void {
  if (!tenantId || tenantId.length > 256 || /[\u0000-\u001f\u007f]/.test(tenantId)) {
    throw new Error('[CRYPTO_INVALID_TENANT] tenantId inválido.');
  }
}

/**
 * AES-256-GCM com derivação HKDF por tenant e AAD contextual.
 *
 * A chave mestre nunca é retornada nem persistida pelo engine. O pacote
 * criptográfico contém apenas material público necessário à decifragem.
 */
export class AltheaCryptoEngine {
  private readonly masterSecret: Buffer;

  public constructor(masterKey: string) {
    if (!masterKey) {
      throw new Error('[CRYPTO_CONFIG_ERROR] Chave mestre ausente.');
    }

    const encoded = Buffer.from(masterKey, 'utf8');
    if (encoded.length < KEY_BYTES) {
      throw new Error('[CRYPTO_CONFIG_ERROR] A chave mestre deve possuir pelo menos 32 bytes UTF-8.');
    }

    // A chave de entrada deve ser um segredo de alta entropia fornecido pelo
    // secret manager. Não fazemos truncamento silencioso de credenciais.
    this.masterSecret = encoded;
  }

  public encryptPayload(plainText: string, tenantId: string): EncryptedPackage {
    assertTenantId(tenantId);

    const plaintext = Buffer.from(plainText, 'utf8');
    if (plaintext.length > MAX_PLAINTEXT_BYTES) {
      throw new Error('[CRYPTO_PAYLOAD_TOO_LARGE] Payload excede o limite criptográfico.');
    }

    try {
      const iv = randomBytes(IV_BYTES);
      const tenantSalt = randomBytes(SALT_BYTES);
      const key = this.deriveTenantKey(tenantId, tenantSalt);
      const aad = this.createAad(tenantId);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });

      cipher.setAAD(aad, { plaintextLength: plaintext.length });
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return {
        version: VERSION,
        algorithm: ALGORITHM,
        iv: iv.toString('hex'),
        ciphertext: ciphertext.toString('hex'),
        authTag: authTag.toString('hex'),
        tenantSalt: tenantSalt.toString('hex'),
      };
    } catch {
      throw new Error('[CRYPTO_ENCRYPTION_ERROR] Falha ao cifrar payload.');
    }
  }

  public decryptPayload(pkg: EncryptedPackage, tenantId: string): string {
    assertTenantId(tenantId);

    try {
      if (pkg.version !== VERSION || pkg.algorithm !== ALGORITHM) {
        throw new Error('unsupported-version');
      }

      const iv = decodeHex(pkg.iv, 'iv');
      const ciphertext = decodeHex(pkg.ciphertext, 'ciphertext');
      const authTag = decodeHex(pkg.authTag, 'authTag');
      const tenantSalt = decodeHex(pkg.tenantSalt, 'tenantSalt');

      if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || tenantSalt.length !== SALT_BYTES) {
        throw new Error('invalid-length');
      }
      if (ciphertext.length > MAX_PLAINTEXT_BYTES) {
        throw new Error('payload-too-large');
      }

      const key = this.deriveTenantKey(tenantId, tenantSalt);
      const aad = this.createAad(tenantId);
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });

      decipher.setAAD(aad, { plaintextLength: ciphertext.length });
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    } catch {
      throw new Error('[CRYPTO_INTEGRITY_VIOLATION] Pacote inválido, adulterado ou pertencente a outro contexto.');
    }
  }

  private deriveTenantKey(tenantId: string, salt: Buffer): Buffer {
    const info = Buffer.from(`althea-pay/iara/aes-gcm/v${VERSION}/tenant/${tenantId}`, 'utf8');
    return Buffer.from(hkdfSync('sha256', this.masterSecret, salt, info, KEY_BYTES));
  }

  private createAad(tenantId: string): Buffer {
    return Buffer.from(`althea-pay/iara/v${VERSION}/tenant/${tenantId}`, 'utf8');
  }
}
