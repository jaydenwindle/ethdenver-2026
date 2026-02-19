import { oc } from "@orpc/contract";
import { z } from "zod";

export const API_PREFIX = "/api/v1" as const;

const unprefixedContract = {
  health: oc
    .route({ method: "GET", path: "/health" })
    .output(z.object({ status: z.literal("ok"), runtime: z.literal("bun") })),
  hello: oc
    .route({ method: "GET", path: "/hello/{name}" })
    .input(z.object({ name: z.string().min(1) }))
    .output(z.object({ message: z.string() })),
  createEthAccount: oc
    .route({ method: "POST", path: "/accounts" })
    .errors({
      UNAUTHORIZED: {
        status: 401,
        message: "request authentication failed",
        data: z.object({
          reason: z.literal("ERC8128_VERIFICATION_FAILED"),
          verificationReason: z.string(),
        }),
      },
      SERVICE_UNAVAILABLE: {
        status: 503,
        message: "dstack unavailable",
        data: z.object({
          reason: z.literal("DSTACK_SOCKET_UNAVAILABLE"),
        }),
      },
    })
    .output(
      z.object({
        owner: z.string(),
        address: z.string(),
      }),
    ),
};

export const contract = oc.prefix(API_PREFIX).router(unprefixedContract);
