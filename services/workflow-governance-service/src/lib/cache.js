import { createClient } from 'redis';

const TTL = {
  METADATA: 300,   // 5 min
  RISK: 3600,      // 1 hr
  LIST: 300,
};

// In-memory fallback when Redis is unavailable
const memCache = new Map();

let client = null;
let redisAvailable = false;

async function connect() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  client = createClient({ url });
  client.on('error', () => { redisAvailable = false; });
  try {
    await client.connect();
    redisAvailable = true;
  } catch {
    console.warn('[cache] Redis unavailable — using in-memory fallback');
    redisAvailable = false;
  }
}

connect().catch(() => {});

async function get(key) {
  if (redisAvailable) {
    try {
      const val = await client.get(key);
      return val ? JSON.parse(val) : null;
    } catch { redisAvailable = false; }
  }
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memCache.delete(key); return null; }
  return entry.value;
}

async function set(key, value, ttlSeconds = TTL.METADATA) {
  if (redisAvailable) {
    try {
      await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return;
    } catch { redisAvailable = false; }
  }
  memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function del(key) {
  if (redisAvailable) {
    try { await client.del(key); return; } catch { redisAvailable = false; }
  }
  memCache.delete(key);
}

export default { get, set, del, TTL };
