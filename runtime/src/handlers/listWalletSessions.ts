import { os } from "../implementation";
import { erc8128AuthMiddleware } from "../middleware/erc8128";
import { listWalletSessions as fetchWalletSessions } from "../services/walletConnectSigner";

export const listWalletSessions = os.listWalletSessions
  .use(erc8128AuthMiddleware)
  .handler(async ({ context }) => {
    const owner = (context as { auth: { address: `0x${string}` } }).auth.address;

    return fetchWalletSessions(owner);
  });
