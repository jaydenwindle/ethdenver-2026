import { os } from "./implementation";
import { connectWalletConnect } from "./handlers/connectWalletConnect";
import { createEthAccount } from "./handlers/createEthAccount";
import { health } from "./handlers/health";
import { hello } from "./handlers/hello";

export const router = os.router({
  health,
  hello,
  createEthAccount,
  connectWalletConnect,
});
