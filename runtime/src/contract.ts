import { oc } from "@orpc/contract";
import { z } from "zod";

export const API_PREFIX = "/api/v1" as const;

const authHeadersSchema = z
  .object({
    "signature-input": z.string().optional(),
    signature: z.string().optional(),
    "content-digest": z.string().optional(),
    "content-type": z.string().optional(),
  })
  .passthrough();

const unprefixedContract = {
  health: oc
    .route({ method: "GET", path: "/health" })
    .output(z.object({ status: z.literal("ok"), runtime: z.literal("bun") })),
  hello: oc
    .route({ method: "GET", path: "/hello/{name}" })
    .input(z.object({ name: z.string().min(1) }))
    .output(z.object({ message: z.string() })),
  createEthAccount: oc
    .route({ method: "POST", path: "/accounts", inputStructure: "detailed" })
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
    .input(
      z.object({
        headers: authHeadersSchema,
      }),
    )
    .output(
      z.object({
        owner: z.string(),
        address: z.string(),
      }),
    ),
  createWalletSession: oc
    .route({ method: "POST", path: "/walletconnectt/sessions", inputStructure: "detailed" })
    .errors({
      UNAUTHORIZED: {
        status: 401,
        message: "request authentication failed",
        data: z.object({
          reason: z.literal("ERC8128_VERIFICATION_FAILED"),
          verificationReason: z.string(),
        }),
      },
      BAD_REQUEST: {
        status: 400,
        message: "invalid WalletConnect request",
        data: z.object({
          reason: z.literal("WALLETCONNECT_BAD_REQUEST"),
          detail: z.string(),
        }),
      },
      SERVICE_UNAVAILABLE: {
        status: 503,
        message: "walletconnect unavailable",
        data: z.object({
          reason: z.literal("WALLETCONNECT_UNAVAILABLE"),
          detail: z.string(),
        }),
      },
    })
    .input(
      z.object({
        headers: authHeadersSchema,
        body: z.object({
          uri: z.string().min(1),
        }),
      }),
    )
    .output(
      z.object({
        owner: z.string(),
        address: z.string(),
        topic: z.string(),
        status: z.literal("pairing_started"),
      }),
    ),
  listWalletSessions: oc
    .route({ method: "GET", path: "/walletconnectt/sessions", inputStructure: "detailed" })
    .errors({
      UNAUTHORIZED: {
        status: 401,
        message: "request authentication failed",
        data: z.object({
          reason: z.literal("ERC8128_VERIFICATION_FAILED"),
          verificationReason: z.string(),
        }),
      },
    })
    .input(
      z.object({
        headers: authHeadersSchema,
      }),
    )
    .output(
      z.array(
        z.object({
          topic: z.string(),
          owner: z.string(),
          address: z.string(),
          domain: z.string().optional(),
          defaultChainId: z.number().int().positive(),
        }),
      ),
    ),
  listWalletSessionOperations: oc
    .route({ method: "GET", path: "/walletconnectt/operations", inputStructure: "detailed" })
    .errors({
      UNAUTHORIZED: {
        status: 401,
        message: "request authentication failed",
        data: z.object({
          reason: z.literal("ERC8128_VERIFICATION_FAILED"),
          verificationReason: z.string(),
        }),
      },
    })
    .input(
      z.object({
        headers: authHeadersSchema,
        query: z
          .object({
            topic: z.string().optional(),
          })
          .optional(),
      }),
    )
    .output(
      z.array(
        z.object({
          id: z.number(),
          topic: z.string(),
          method: z.string(),
          chainId: z.string(),
          params: z.unknown(),
          status: z.enum(["proposed", "succeeded", "failed"]),
          timestamp: z.number(),
          result: z.unknown().optional(),
          error: z.string().optional(),
        }),
      ),
    ),
};

export const contract = oc.prefix(API_PREFIX).router(unprefixedContract);
