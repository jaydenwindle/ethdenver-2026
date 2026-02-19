import { signRequest, type EthHttpSigner } from "@slicekit/erc8128";
import { mnemonicToAccount } from "viem/accounts";

const FORGE_TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

const baseUrl = process.env.API_BASE_URL ?? "http://localhost:8000";
const endpoint = `${baseUrl}/api/v1/accounts`;

const signerAccount = mnemonicToAccount(FORGE_TEST_MNEMONIC, {
  accountIndex: 0,
});

const signer: EthHttpSigner = {
  address: signerAccount.address,
  chainId: Number(process.env.CHAIN_ID ?? "1"),
  signMessage: async (message) => {
    return signerAccount.signMessage({ message: { raw: message } });
  },
};

const signedRequest = await signRequest(
  endpoint,
  {
    method: "POST",
  },
  signer,
);

const response = await fetch(signedRequest);
const bodyText = await response.text();

console.log(`[accounts] status=${response.status}`);
console.log(`[accounts] body=${bodyText}`);
