import type { AnyMiddleware } from "@orpc/server";
import { createVerifierClient, type NonceStore } from "@slicekit/erc8128";
import { getAddress } from "viem";
import { verifyMessage } from "viem";

const usedNonces = new Map<string, number>();

const nonceStore: NonceStore = {
  async consume(key, ttlSeconds) {
    const now = Date.now();
    const expiresAt = usedNonces.get(key);

    if (expiresAt !== undefined && expiresAt > now) {
      return false;
    }

    usedNonces.set(key, now + ttlSeconds * 1000);

    return true;
  },
};

const erc8128Verifier = createVerifierClient({
  verifyMessage,
  nonceStore,
  defaults: {
    label: "eth",
    strictLabel: true,
    replayable: false,
    maxValiditySec: 120,
    maxNonceWindowSec: 120,
    clockSkewSec: 10,
  },
});

export const erc8128AuthMiddleware: AnyMiddleware = async ({
  input,
  context,
  errors,
  next,
}: any) => {
  const request = context.request as Request;
  const authRequest = buildVerificationRequest(request, input);
  const verification = await erc8128Verifier.verifyRequest({ request: authRequest });

  if (!verification.ok) {
    const signatureInput = request.headers.get("signature-input");
    const signature = request.headers.get("signature");
    const contentDigest = request.headers.get("content-digest");

    console.error("[erc8128] verification failed", {
      reason: verification.reason,
      method: request.method,
      url: request.url,
      bodyUsed: request.bodyUsed,
      authBodyUsed: authRequest.bodyUsed,
      contentType: request.headers.get("content-type"),
      contentDigest,
      signatureInput,
      signature: signature ? `${signature.slice(0, 32)}...` : null,
    });

    throw errors.UNAUTHORIZED({
      message: "ERC-8128 verification failed",
      data: {
        reason: "ERC8128_VERIFICATION_FAILED",
        verificationReason: verification.reason,
      },
    });
  }

  return next({
    context: {
      auth: {
        address: getAddress(verification.address),
        chainId: verification.chainId,
      },
    },
  });
};

function buildVerificationRequest(request: Request, input: unknown): Request {
  const headers = new Headers();
  const typedHeaders =
    input && typeof input === "object" && "headers" in input
      ? ((input as { headers?: Record<string, unknown> }).headers ?? {})
      : {};

  for (const [name, value] of Object.entries(typedHeaders)) {
    if (typeof value === "string") {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      headers.set(name, value.map((part) => String(part)).join(", "));
    } else if (value !== undefined && value !== null) {
      headers.set(name, String(value));
    }
  }

  const body =
    input && typeof input === "object" && "body" in input
      ? serializeBody((input as { body?: unknown }).body)
      : undefined;

  return new Request(request.url, {
    method: request.method,
    headers,
    body,
  });
}

function serializeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body);
}
