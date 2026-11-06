// EP-306-S12 — API key generation/hashing. SHA-256 (not bcrypt): the raw key is
// already 256 bits of generated entropy, unlike a human password, so a fast hash is
// appropriate and avoids bcrypt's per-request cost on every exchange call.
import crypto from 'crypto';

const PREFIX = 'ioak_';

export function generateApiKey() {
  return PREFIX + crypto.randomBytes(32).toString('hex');
}

export function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function keyPrefix(rawKey) {
  return rawKey.slice(0, PREFIX.length + 8);
}
