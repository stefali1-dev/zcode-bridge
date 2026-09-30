import { z } from 'zod';
import type { ZodType } from 'zod';
import * as chats from './domain/chats.js';
import { MODEL_IDS } from './driver/selectors.js';

export interface Tool {
  name: string;
  description: string;
  shape: Record<string, ZodType>;
  run: (args: Record<string, never>) => Promise<unknown>;
}

export const tools: Tool[] = [
  {
    name: 'app_status',
    description: 'Is the ZCode desktop app running, is its control socket on, bridge connection state, queue depth, known models.',
    shape: {},
    run: () => chats.status(),
  },
  {
    name: 'chat_send',
    description:
      'Send a message to a task chat in the ZCode app; creates a new chat when `chat` is omitted. ' +
      'Chats run outside your repo: give absolute paths (e.g. `git -C /abs/repo diff`). ' +
      'New chats default to glm-5.3-flash on the start-plan bundle (free tokens; falls back to the individual plan ' +
      'if unavailable) and full-access permission mode. Omitted settings stay as the chat already uses. ' +
      'The result reports which model/plan actually paid. Returns at once with the chat id; ' +
      'pass wait_for_reply or call chat_wait for the reply.',
    shape: {
      text: z.string().min(1).describe('message to send'),
      model: z.enum(MODEL_IDS).optional().describe('e.g. glm-5.3 or glm-5.3-flash'),
      plan: z.enum(['individual', 'start-plan']).optional().describe('which token pool pays (start-plan = free bundle)'),
      effort: z.enum(['low', 'medium', 'high', 'max']).optional().describe('reasoning effort'),
      mode: z.enum(['full-access', 'ask', 'accept-edits', 'plan']).optional().describe('permission mode'),
      chat: z.string().optional().describe('chat id or "latest"; omit to start a new chat'),
      wait_for_reply: z.boolean().optional().describe('default false'),
      timeout_ms: z.number().int().positive().optional().describe('reply wait timeout, default 30 min'),
    },
    run: (a) => chats.send(a as never),
  },
  {
    name: 'chat_read',
    description: 'Read the conversation of a chat so far (messages newest last, each truncated to 800 chars).',
    shape: {
      chat: z.string().describe('chat id from chat_send, e.g. c4'),
      tail: z.number().int().positive().optional().describe('how many messages, default 10'),
    },
    run: (a) => chats.read(a as never),
  },
  {
    name: 'chat_wait',
    description:
      'Wait until the chat is no longer working, then return its latest reply. ' +
      'Status "running" means the timeout passed first: call it again.',
    shape: {
      chat: z.string().describe('chat id from chat_send, e.g. c4'),
      timeout_ms: z.number().int().positive().optional().describe('default 30 min'),
    },
    run: (a) => chats.wait(a as never),
  },
  {
    name: 'chat_stop',
    description: 'Stop a working chat (presses its Stop button). Send to it again to continue.',
    shape: { chat: z.string().describe('chat id from chat_send, e.g. c4') },
    run: (a) => chats.stop(a as never),
  },
  {
    name: 'chats_list',
    description: 'List chats known to the bridge, with running state and model.',
    shape: {},
    run: () => chats.list(),
  },
  {
    name: 'ui_snapshot',
    description: 'Escape hatch: list currently visible buttons/inputs in the ZCode window, each addressable by ref in ui_click/ui_type.',
    shape: {},
    run: () => chats.uiSnapshot(),
  },
  {
    name: 'ui_click',
    description: 'Escape hatch: click an element from ui_snapshot by its ref.',
    shape: { ref: z.string() },
    run: (a) => chats.uiClick(a as never),
  },
  {
    name: 'ui_type',
    description: 'Escape hatch: type text into an element from ui_snapshot by its ref.',
    shape: { ref: z.string(), text: z.string() },
    run: (a) => chats.uiType(a as never),
  },
  {
    name: 'ui_screenshot',
    description: 'Escape hatch: capture the ZCode window as a PNG image.',
    shape: {},
    run: () => chats.uiScreenshot(),
  },
];

export function findTool(name: string): Tool | undefined {
  return tools.find((t) => t.name === name);
}
