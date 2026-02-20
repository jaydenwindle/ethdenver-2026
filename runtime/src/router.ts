import { os } from "./implementation";
import { createEthAccount } from "./handlers/createEthAccount";
import { createWalletSession } from "./handlers/createWalletSession";
import { health } from "./handlers/health";
import { hello } from "./handlers/hello";
import { listWalletSessionOperations } from "./handlers/listWalletSessionOperations";
import { listWalletSessions } from "./handlers/listWalletSessions";

export const router = os.router({
  health,
  hello,
  createEthAccount,
  createWalletSession,
  listWalletSessions,
  listWalletSessionOperations,
});
