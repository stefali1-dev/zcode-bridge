import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STATE_DIR = process.env.ZBRIDGE_HOME ?? path.join(os.homedir(), '.zcode/bridge');

const FILE = path.join(STATE_DIR, 'registry.json');

export interface RegistryChat {
  id: string;
  sessId: string;
  title: string;
  owner: string;
  createdAt: string;
  /** Last send, epoch ms: transcript records older than this belong to the previous turn. */
  sentAt?: number;
}

interface RegistryData {
  chats: RegistryChat[];
}

export function load(): RegistryData {
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    if (Array.isArray(data.chats)) return data;
  } catch {
    // missing or corrupt file — start fresh
  }
  return { chats: [] };
}

export function save(data: RegistryData): void {
  mkdirSync(STATE_DIR, { recursive: true });
  // Atomic replace: a concurrent reader (or a stray second serve) never sees a partial file.
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, FILE);
}

export function add(chat: Omit<RegistryChat, 'id' | 'createdAt'>): RegistryChat {
  const data = load();
  const entry: RegistryChat = {
    ...chat,
    id: `c${data.chats.length + 1}`,
    createdAt: new Date().toISOString(),
  };
  data.chats.push(entry);
  save(data);
  return entry;
}

export function markSent(id: string, sentAt: number): void {
  const data = load();
  const chat = data.chats.find((c) => c.id === id);
  if (chat) chat.sentAt = sentAt;
  save(data);
}

export function resolve(ref: string): RegistryChat {
  const found = load().chats.find((c) => c.id === ref || c.sessId === ref);
  if (!found) throw new Error(`chat "${ref}" unknown — chats_list shows known chats`);
  return found;
}

export function list(): RegistryChat[] {
  return load().chats;
}
