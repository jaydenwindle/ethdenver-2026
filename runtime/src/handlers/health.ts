import { os } from "../implementation";

export const health = os.health.handler(() => {
  return {
    status: "ok" as const,
    runtime: "bun" as const,
  };
});
