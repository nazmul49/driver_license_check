import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Envelope encryption (SPEC 12): every object gets a random 256-bit data key; the object is
 * encrypted with AES-256-GCM under the data key, and the data key is wrapped with the master
 * key (also AES-256-GCM). The master key id is stored in the envelope and alongside the object,
 * so master keys can rotate while old objects stay readable.
 *
 * Envelope layout (binary):
 *   u8 version(1) | u8 keyIdLen | keyId | 12B wrapIv | 16B wrapTag | 32B wrappedKey
 *   | 12B dataIv | 16B dataTag | ciphertext
 */
export interface KeyRing {
  currentKeyId: string;
  keys: Map<string, Buffer>;
}

const VERSION = 1;

function gcmEncrypt(key: Buffer, plaintext: Buffer, aad: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

function gcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer, aad: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export class Encryptor {
  constructor(private readonly ring: KeyRing) {
    if (!ring.keys.has(ring.currentKeyId)) throw new Error('Current encryption key missing');
  }

  get currentKeyId(): string {
    return this.ring.currentKeyId;
  }

  encrypt(plaintext: Buffer): { envelope: Buffer; keyId: string } {
    const keyId = this.ring.currentKeyId;
    const master = this.ring.keys.get(keyId)!;
    const keyIdBuf = Buffer.from(keyId, 'utf8');
    const header = Buffer.concat([Buffer.from([VERSION, keyIdBuf.length]), keyIdBuf]);
    const dataKey = randomBytes(32);
    try {
      const wrapped = gcmEncrypt(master, dataKey, header);
      const data = gcmEncrypt(dataKey, plaintext, header);
      return {
        envelope: Buffer.concat([
          header,
          wrapped.iv,
          wrapped.tag,
          wrapped.ct,
          data.iv,
          data.tag,
          data.ct,
        ]),
        keyId,
      };
    } finally {
      dataKey.fill(0);
    }
  }

  decrypt(envelope: Buffer): Buffer {
    if (envelope.length < 2 || envelope[0] !== VERSION) throw new Error('Unknown envelope version');
    const idLen = envelope[1]!;
    let o = 2;
    const keyId = envelope.subarray(o, o + idLen).toString('utf8');
    o += idLen;
    const header = envelope.subarray(0, o);
    const master = this.ring.keys.get(keyId);
    if (!master) throw new Error(`Encryption key "${keyId}" not available`);
    const take = (n: number) => {
      const b = envelope.subarray(o, o + n);
      o += n;
      return b;
    };
    const wIv = take(12);
    const wTag = take(16);
    const wCt = take(32);
    const dIv = take(12);
    const dTag = take(16);
    const ct = envelope.subarray(o);
    const dataKey = gcmDecrypt(master, wIv, wTag, wCt, header);
    try {
      return gcmDecrypt(dataKey, dIv, dTag, ct, header);
    } finally {
      dataKey.fill(0);
    }
  }

  encryptJson(value: unknown) {
    return this.encrypt(Buffer.from(JSON.stringify(value), 'utf8'));
  }

  decryptJson<T>(envelope: Buffer): T {
    return JSON.parse(this.decrypt(envelope).toString('utf8')) as T;
  }
}

export function hmacHex(secret: string | Buffer, value: string | Buffer): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Constant-time comparison of two strings (SPEC 12: secrets compared in constant time). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still spend comparable time so the length difference is not a fast path.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
