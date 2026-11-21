import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface StoredOwnerAuth {
  plexToken: string;
  plexUserId: number;
  username: string;
  email?: string;
  thumb?: string;
  serverMachineId: string;
  serverName: string;
  plexUrl: string;
  updatedAtMs: number;
}

export interface StoredFriendAuth {
  plexToken: string;
  plexUserId: number;
  username: string;
  email?: string;
  thumb?: string;
  updatedAtMs: number;
}

export interface PersistedSettings {
  allowPlexFriends: boolean;
  webhookUrl: string;
  webhookAutoNotify: boolean;
  defaultHostOnlyControl: boolean;
}

interface CipherBlob {
  iv: string;
  tag: string;
  data: string;
}

interface PersistedEnvelope {
  version: 1 | 2;
  hostAuthCipher?: CipherBlob;
  ownerAuthCipher?: CipherBlob;
  friendAuthCiphers?: Record<string, CipherBlob>;
  settings?: Partial<PersistedSettings>;
  roomDefaults?: {
    hostOnlyControl?: boolean;
  };
}

export class StateStorage {
  private readonly filePath: string;
  private readonly key: Buffer;
  private cache: PersistedEnvelope;

  constructor(dataDir: string, appSecret: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'state.json');
    this.key = crypto.scryptSync(appSecret, 'watchtogether-storage-v1', 32);
    this.cache = this.readFromDisk();
  }

  private readFromDisk(): PersistedEnvelope {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedEnvelope;
      if (parsed && (parsed.version === 1 || parsed.version === 2)) {
        return parsed;
      }
    } catch {
      // Missing or invalid state file starts clean
    }
    return { version: 2 };
  }

  private writeToDisk(): void {
    this.cache.version = 2;
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.cache, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, this.filePath);
  }

  private encryptJson(value: unknown): CipherBlob {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64url'),
      tag: tag.toString('base64url'),
      data: encrypted.toString('base64url')
    };
  }

  private decryptJson<T>(cipherObj: CipherBlob | undefined): T | null {
    if (!cipherObj) return null;
    try {
      const iv = Buffer.from(cipherObj.iv, 'base64url');
      const tag = Buffer.from(cipherObj.tag, 'base64url');
      const data = Buffer.from(cipherObj.data, 'base64url');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8')) as T;
    } catch {
      return null;
    }
  }

  getOwnerAuth(fallbackPlexUrl = ''): StoredOwnerAuth | null {
    const modern = this.decryptJson<StoredOwnerAuth>(this.cache.ownerAuthCipher);
    if (modern) {
      return {
        ...modern,
        plexUrl: modern.plexUrl || fallbackPlexUrl
      };
    }

    // Seamless upgrade from v0.1 hostAuthCipher
    const legacy = this.decryptJson<Omit<StoredOwnerAuth, 'plexUrl'> & { plexUrl?: string }>(
      this.cache.hostAuthCipher
    );
    if (!legacy) return null;
    return {
      ...legacy,
      plexUrl: legacy.plexUrl || fallbackPlexUrl
    };
  }

  setOwnerAuth(auth: StoredOwnerAuth): void {
    this.cache.ownerAuthCipher = this.encryptJson(auth);
    delete this.cache.hostAuthCipher;
    this.writeToDisk();
  }

  clearOwnerAuth(): void {
    delete this.cache.ownerAuthCipher;
    delete this.cache.hostAuthCipher;
    this.writeToDisk();
  }

  getFriendAuth(plexUserId: number): StoredFriendAuth | null {
    return this.decryptJson<StoredFriendAuth>(this.cache.friendAuthCiphers?.[String(plexUserId)]);
  }

  setFriendAuth(auth: StoredFriendAuth): void {
    if (!this.cache.friendAuthCiphers) {
      this.cache.friendAuthCiphers = {};
    }
    this.cache.friendAuthCiphers[String(auth.plexUserId)] = this.encryptJson(auth);
    this.writeToDisk();
  }

  getSettings(): PersistedSettings {
    const s = this.cache.settings ?? {};
    return {
      allowPlexFriends: s.allowPlexFriends ?? false,
      webhookUrl: s.webhookUrl ?? '',
      webhookAutoNotify: s.webhookAutoNotify ?? false,
      defaultHostOnlyControl: s.defaultHostOnlyControl ?? this.cache.roomDefaults?.hostOnlyControl ?? false
    };
  }

  updateSettings(patch: Partial<PersistedSettings>): PersistedSettings {
    const current = this.getSettings();
    const next: PersistedSettings = {
      ...current,
      ...patch
    };
    this.cache.settings = next;
    this.writeToDisk();
    return next;
  }

  getActivePlexUrl(envPlexUrl: string): string {
    const owner = this.getOwnerAuth(envPlexUrl);
    if (owner?.plexUrl) return owner.plexUrl.replace(/\/+$/, '');
    return envPlexUrl.replace(/\/+$/, '');
  }

  isSetupComplete(envPlexUrl: string): boolean {
    const owner = this.getOwnerAuth(envPlexUrl);
    return Boolean(owner?.plexToken && (owner.plexUrl || envPlexUrl));
  }
}
