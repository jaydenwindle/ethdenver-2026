import { implement } from "@orpc/server";

import { contract } from "./contract";

export const os = implement(contract).$context<{
  request: Request;
}>();
