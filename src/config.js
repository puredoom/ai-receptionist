// Minimal .env loader (no dependency). Loads ../.env if present, without
// overwriting variables that are already set in the environment.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function normalizeBaseUrl(raw) {
  let url = (raw || 'http://localhost:3000').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    // bare domains get https://, except localhost which is plain http
    url = (/^(localhost|127\.0\.0\.1)([:/]|$)/.test(url) ? 'http://' : 'https://') + url;
  }
  return url;
}

export const cfg = {
  port: Number(process.env.PORT || 3000),
  baseUrl: normalizeBaseUrl(process.env.BASE_URL),
  adminKey: process.env.ADMIN_KEY || '',
  vapiApiKey: process.env.VAPI_API_KEY || '',
  vapiWebhookSecret: process.env.VAPI_WEBHOOK_SECRET || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  defaultVoiceId: process.env.DEFAULT_VOICE_ID || 'XB0fDUnXU5powFXDhCwa',
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'receptionist.db'),
};
