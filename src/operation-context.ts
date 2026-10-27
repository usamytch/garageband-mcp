import { AsyncLocalStorage } from "node:async_hooks";

export const operationContext = new AsyncLocalStorage<{
  projectPath: string;
  verify: () => Promise<void>;
}>();
