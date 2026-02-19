import { os } from "./implementation";
import { createEthAccount } from "./handlers/createEthAccount";
import { health } from "./handlers/health";
import { hello } from "./handlers/hello";

export const router = os.router({
  health,
  hello,
  createEthAccount,
});
