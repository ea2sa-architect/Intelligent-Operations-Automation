import helmet from 'helmet';

// EP-310-S4 — HTTP security response headers applied to every outbound response.
// CSP and COEP are disabled: these services return JSON, not HTML documents.
export default helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
});

