import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { homedir } from 'os';

const VAULT_DIR = path.join(homedir(), '.unit01');
const VAULT_FILE = path.join(VAULT_DIR, 'credentials.json');

// Memory store for decrypted Vault Master Key during active session
let sessionVaultKey: Buffer | null = null;

interface EncryptedPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

interface VaultData {
  salt: string;
  password_vault: EncryptedPayload;
  recovery_vault: EncryptedPayload;
  credentials: Record<string, EncryptedPayload>;
}

/**
 * Generate a 24-character security recovery key formatted like:
 * UNIT01-XXXX-XXXX-XXXX-XXXX
 */
export function generateRecoveryKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars (O, 0, I, 1)
  let key = 'UNIT01';
  for (let i = 0; i < 4; i++) {
    let segment = '';
    for (let j = 0; j < 4; j++) {
      const idx = crypto.randomInt(chars.length);
      segment += chars[idx];
    }
    key += `-${segment}`;
  }
  return key;
}

/**
 * Encrypt a plaintext string using a 256-bit key (AES-256-GCM).
 */
function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return {
    iv: iv.toString('hex'),
    tag,
    ciphertext
  };
}

/**
 * Decrypt an EncryptedPayload using a 256-bit key.
 */
function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let plaintext = decipher.update(payload.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/**
 * Derive a 256-bit key from a password/key and a salt using Scrypt.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });
}

/**
 * Initialize a new vault file with a Master Password.
 * Returns the generated Master Recovery Key.
 */
export function initializeVault(password: string): string {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
  }

  const salt = crypto.randomBytes(16);
  const vaultKey = crypto.randomBytes(32); // The core key that encrypts all credentials
  const recoveryKey = generateRecoveryKey();

  // Derive encryption keys for locking the vaultKey
  const passwordKey = deriveKey(password, salt);
  const recoveryKeyDerived = deriveKey(recoveryKey, salt);

  // Encrypt the vaultKey using both keys
  const passwordVault = encrypt(vaultKey.toString('hex'), passwordKey);
  const recoveryVault = encrypt(vaultKey.toString('hex'), recoveryKeyDerived);

  const vaultData: VaultData = {
    salt: salt.toString('hex'),
    password_vault: passwordVault,
    recovery_vault: recoveryVault,
    credentials: {}
  };

  fs.writeFileSync(VAULT_FILE, JSON.stringify(vaultData, null, 2), { mode: 0o600 });
  
  // Set in session memory
  sessionVaultKey = vaultKey;

  return recoveryKey;
}

/**
 * Checks if the vault file exists on disk.
 */
export function vaultExists(): boolean {
  return fs.existsSync(VAULT_FILE);
}

/**
 * Attempt to unlock the vault using the Master Password.
 * Caches the decrypted Vault Master Key in session memory.
 */
export function unlockWithPassword(password: string): boolean {
  try {
    if (!vaultExists()) return false;
    const data = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) as VaultData;
    const salt = Buffer.from(data.salt, 'hex');
    const passwordKey = deriveKey(password, salt);
    
    const decryptedVaultKeyHex = decrypt(data.password_vault, passwordKey);
    sessionVaultKey = Buffer.from(decryptedVaultKeyHex, 'hex');
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Attempt to unlock the vault using the Master Recovery Key.
 * Caches the decrypted Vault Master Key in session memory.
 */
export function unlockWithRecoveryKey(recoveryKey: string): boolean {
  try {
    if (!vaultExists()) return false;
    const data = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) as VaultData;
    const salt = Buffer.from(data.salt, 'hex');
    const recoveryKeyDerived = deriveKey(recoveryKey, salt);

    const decryptedVaultKeyHex = decrypt(data.recovery_vault, recoveryKeyDerived);
    sessionVaultKey = Buffer.from(decryptedVaultKeyHex, 'hex');
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Reset the vault's Master Password using the Master Recovery Key.
 */
export function resetVaultPassword(recoveryKey: string, newPassword: string): boolean {
  try {
    if (!unlockWithRecoveryKey(recoveryKey)) {
      return false;
    }
    if (!sessionVaultKey) return false;

    const data = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) as VaultData;
    const salt = Buffer.from(data.salt, 'hex');

    // Re-derive password key and re-encrypt the Vault Master Key
    const newPasswordKey = deriveKey(newPassword, salt);
    const newPasswordVault = encrypt(sessionVaultKey.toString('hex'), newPasswordKey);

    data.password_vault = newPasswordVault;

    fs.writeFileSync(VAULT_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Save a service token in the decrypted vault file.
 */
export function saveCredential(service: string, token: string): void {
  if (!sessionVaultKey) {
    throw new Error('Vault is locked. Unlock the vault before saving credentials.');
  }

  const data = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) as VaultData;
  data.credentials[service] = encrypt(token, sessionVaultKey);
  
  fs.writeFileSync(VAULT_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Retrieve a service token from the decrypted vault file.
 */
export function getCredential(service: string): string | null {
  if (!sessionVaultKey) {
    throw new Error('Vault is locked. Unlock the vault before retrieving credentials.');
  }

  try {
    const data = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) as VaultData;
    const payload = data.credentials[service];
    if (!payload) return null;
    return decrypt(payload, sessionVaultKey);
  } catch (err) {
    return null;
  }
}

/**
 * Remove a service token from the vault.
 */
export function deleteCredential(service: string): void {
  if (!sessionVaultKey) {
    throw new Error('Vault is locked. Unlock the vault before modifying credentials.');
  }

  const data = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) as VaultData;
  if (data.credentials[service]) {
    delete data.credentials[service];
    fs.writeFileSync(VAULT_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
}

/**
 * Lock the vault by clearing the session memory key.
 */
export function lockVault(): void {
  sessionVaultKey = null;
}
