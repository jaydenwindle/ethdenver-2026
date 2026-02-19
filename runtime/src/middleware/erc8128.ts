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
  context,
  errors,
  next,
}: any) => {
  const verification = await erc8128Verifier.verifyRequest({ request: context.request });

  if (!verification.ok) {
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
