import { DstackClient } from "@phala/dstack-sdk";
import { toViemAccount } from "@phala/dstack-sdk/viem";

import { os } from "../implementation";
import { erc8128AuthMiddleware } from "../middleware/erc8128";

export const createEthAccount = os.createEthAccount
  .use(erc8128AuthMiddleware)
  .handler(async ({ context, errors }) => {
    const owner = (context as { auth: { address: `0x${string}` } }).auth.address;

    try {
      const dstack = new DstackClient();
      const key = await dstack.getKey(`wallet/ethereum/${owner}`);
      const account = toViemAccount(key);

      return {
        owner,
        address: account.address,
      };
    } catch (error) {
      if (isSocketAccessError(error)) {
        throw errors.SERVICE_UNAVAILABLE({
          message:
            "dstack socket is unavailable. ensure DSTACK_SIMULATOR_ENDPOINT is set or /var/run/dstack.sock is accessible",
          data: {
            reason: "DSTACK_SOCKET_UNAVAILABLE",
          },
        });
      }

      throw error;
    }
  });

function isSocketAccessError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Unix socket file") ||
    error.message.includes("ENOENT") ||
    error.message.includes("EACCES") ||
    error.message.includes("ECONNREFUSED")
  );
}
