import crypto from 'crypto';

// Session signing secret: reads from process.env or generates an ephemeral in-memory 32-byte key
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Encryption secret for stored API keys: reads from process.env or derives from session secret
const ENC_KEY_SOURCE = process.env.API_KEY_ENC_SECRET || SESSION_SECRET;
const AES_KEY = crypto.scryptSync(ENC_KEY_SOURCE, 'mkc-cbt-api-key-salt', 32);

export interface AuthTokenPayload {
  userId: number;
  username: string;
  role: 'admin' | 'guru' | 'pengawas' | 'siswa';
  fullName: string;
  className: string;
  exp: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 2048, r: 8, p: 1 }).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHex] = storedHash.split(':');
  if (!salt || !originalHex) return false;
  const derived = crypto.scryptSync(password, salt, 64, { N: 2048, r: 8, p: 1 });
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function verifyPasswordAsync(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!storedHash || !storedHash.includes(':')) return resolve(false);
    const [salt, originalHex] = storedHash.split(':');
    if (!salt || !originalHex) return resolve(false);
    crypto.scrypt(password, salt, 64, { N: 2048, r: 8, p: 1 }, (err, derived) => {
      if (err) return resolve(false);
      const original = Buffer.from(originalHex, 'hex');
      if (derived.length !== original.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derived, original));
    });
  });
}

export function signAuthToken(payload: Omit<AuthTokenPayload, 'exp'>, ttlSeconds = 60 * 60 * 12): string {
  const fullPayload: AuthTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(cipherText: string): string | null {
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function maskSecret(plaintext: string): string {
  if (!plaintext) return '';
  if (plaintext.length <= 8) return '••••••••';
  return `${plaintext.slice(0, 4)}••••••••••••${plaintext.slice(-4)}`;
}
