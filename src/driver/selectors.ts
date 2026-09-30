// Selector map verified against the live DOM (app 3.14.4, 2026-09-29).
// Re-verify with `node scripts/dom-dump.mjs` and `node scripts/menu-dump.mjs` after app updates.

export const MODEL_IDS = [
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.2',
  'glm-5.1',
  'glm-5.1-highspeed',
  'glm-5v-turbo',
] as const;

const MODEL_DISPLAY: Record<string, string> = {
  'glm-5.3': 'GLM-5.3',
  'glm-5.3-flash': 'GLM-5.3-Flash',
  'glm-5.2': 'GLM-5.2',
  'glm-5.1': 'GLM-5.1',
  'glm-5.1-highspeed': 'GLM-5.1-Highspeed',
  'glm-5v-turbo': 'GLM-5V-Turbo',
};

export function modelDisplay(id: string): string {
  return MODEL_DISPLAY[id] ?? id;
}

export const S = {
  chatInput: ['[data-testid="v4-composer-input"]'],
  newTask: ['[data-testid="conversation-new-task"]', '[data-testid="task-new-button"]'],
  modelPicker: ['[data-testid="chat-model-select-trigger"]'],
  modePicker: ['[data-testid="chat-mode-select-trigger"]'],
  stop: ['[data-testid="v4-stop"]'],
  taskItems: '[data-testid^="task-item-sess_"]',
};

const PLAN_ACCOUNT: Record<string, string> = {
  individual: 'individual-coding-plan',
  'start-plan': 'start-plan',
};

export function modelItem(modelDisplay_: string, plan = 'individual'): string[] {
  const account = PLAN_ACCOUNT[plan] ?? plan;
  return [`[data-testid="chat-model-select-item-custom:account%3Azai-${account}:${modelDisplay_}"]`];
}

const MODE_ITEM: Record<string, string> = {
  'full-access': 'chat-mode-select-item-yolo',
  ask: 'chat-mode-select-item-build',
  'accept-edits': 'chat-mode-select-item-edit',
  plan: 'chat-mode-select-item-plan',
};

export function modeItem(mode: string): string[] {
  const testid = MODE_ITEM[mode];
  if (!testid) throw new Error(`unknown mode "${mode}" — use full-access | ask | accept-edits | plan`);
  return [`[data-testid="${testid}"]`];
}

export function chatItem(sessId: string): string[] {
  return [`[data-testid="task-item-${sessId}"]`];
}
