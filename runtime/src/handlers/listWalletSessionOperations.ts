import { os } from "../implementation";
import { erc8128AuthMiddleware } from "../middleware/erc8128";
import { listWalletSessionOperations as fetchWalletSessionOperations } from "../services/walletConnectSigner";

export const listWalletSessionOperations = os.listWalletSessionOperations
  .use(erc8128AuthMiddleware)
  .handler(async ({ context, input }) => {
    const owner = (context as { auth: { address: `0x${string}` } }).auth.address;
    const topic = input.query?.topic;

    return fetchWalletSessionOperations(owner, topic);
  });
