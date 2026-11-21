import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.string().default(''),
  PLEX_URL: z.string().default(''),
  APP_SECRET: z.string().optional(),
  DATA_DIR: z.string().min(1).default('./data'),
  CLIENT_IDENTIFIER: z.string().min(4).default('syncreel-plex-01')
});

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  publicUrl: string;
  plexUrl: string;
  appSecret: string;
  dataDir: string;
  clientIdentifier: string;
  isHttps: boolean;
}

function loadOrGenerateSecret(dataDir: string): string {
  fs.mkdirSync(dataDir, { recursive: true });
  const secretPath = path.join(dataDir, 'secret.key');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) {
      return existing;
    }
  } catch {
    // Missing or unreadable: generate below
  }

  const generated = crypto.randomBytes(32).toString('hex');
  const tmpPath = `${secretPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, secretPath);
  return generated;
}

export function loadConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  const merged = { ...process.env, ...overrides };
  const parsed = EnvSchema.parse(merged);

  const dataDir = path.resolve(parsed.DATA_DIR);
  let appSecret = parsed.APP_SECRET?.trim() ?? '';
  const isPlaceholder =
    !appSecret || appSecret === 'replace-with-64-char-hex-secret' || appSecret.length < 32;

  if (isPlaceholder) {
    appSecret = loadOrGenerateSecret(dataDir);
    if (parsed.NODE_ENV !== 'test') {
      console.info(`[SyncReel] Using auto-generated secret persisted at ${path.join(dataDir, 'secret.key')}`);
    }
  }

  const publicUrl = parsed.PUBLIC_URL.trim().replace(/\/+$/, '');
  const plexUrl = parsed.PLEX_URL.trim().replace(/\/+$/, '');

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    publicUrl,
    plexUrl,
    appSecret,
    dataDir,
    clientIdentifier: parsed.CLIENT_IDENTIFIER,
    isHttps: publicUrl.startsWith('https://')
  };
}
