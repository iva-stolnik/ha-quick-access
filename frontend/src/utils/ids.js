export const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `qa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
