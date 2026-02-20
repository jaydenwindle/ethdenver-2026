import { os } from "../implementation";
import { erc8128AuthMiddleware } from "../middleware/erc8128";
import { createWalletSession as kickoffWalletSession } from "../services/walletConnectSigner";

export const createWalletSession = os.createWalletSession
  .use(erc8128AuthMiddleware)
  .handler(async ({ context, input, errors }) => {
    const owner = (context as { auth: { address: `0x${string}` } }).auth.address;
    const uri = input.body.uri;

    if (!uri.startsWith("wc:")) {
      throw errors.BAD_REQUEST({
        message: "invalid WalletConnect URI",
        data: {
          reason: "WALLETCONNECT_BAD_REQUEST",
          detail: "uri must start with wc:",
        },
      });
    }

    try {
      const kickoff = await kickoffWalletSession({
        owner,
        uri,
      });

      return {
        owner,
        address: kickoff.address,
        topic: kickoff.topic,
        status: kickoff.status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "WalletConnect unavailable";

      throw errors.SERVICE_UNAVAILABLE({
        message: "WalletConnect unavailable",
        data: {
          reason: "WALLETCONNECT_UNAVAILABLE",
          detail: message,
        },
      });
    }
  });
