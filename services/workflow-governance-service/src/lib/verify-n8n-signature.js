import { createHmac, timingSafeEqual } from 'crypto';

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // EP-310-S2: reject callbacks older than 5 min

// EP-310-S1/S2 — HMAC-SHA256 signature + timestamp replay-attack prevention.
// When N8N_WEBHOOK_SECRET is set, every inbound callback must carry:
//   X-IOA-Signature: sha256=<HMAC-SHA256(rawBody, secret)>
//   X-IOA-Timestamp: <Unix epoch ms>           (must be within 5 min of now)
// If the env var is absent both checks are skipped (existing open behaviour),
// allowing gradual rollout: set the secret here and matching headers in the
// n8n HTTP Request node to fully close the gap.
export default function verifyN8nCallback(req, res, next) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return next();

  // ── S2: timestamp window ─────────────────────────────────────────────────
  const tsHeader = req.headers['x-ioa-timestamp'];
  if (!tsHeader) return res.status(401).json({ error: 'Missing X-IOA-Timestamp header' });
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) {
    return res.status(401).json({ error: 'Callback timestamp outside acceptable window' });
  }

  // ── S1: HMAC signature ───────────────────────────────────────────────────
  const sig = req.headers['x-ioa-signature'];
  if (!sig) return res.status(401).json({ error: 'Missing X-IOA-Signature header' });

  const raw = req.rawBody;
  if (!raw) return res.status(500).json({ error: 'Signature verification unavailable — raw body not captured' });

  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  next();
}
