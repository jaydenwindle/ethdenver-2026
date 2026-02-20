import { signedFetch, type EthHttpSigner } from "@slicekit/erc8128";
import { mnemonicToAccount } from "viem/accounts";

const FORGE_TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

const baseUrl = process.env.API_BASE_URL ?? "http://localhost:8000";
const endpoint = `${baseUrl}/api/v1/walletconnectt/sessions`;
const walletConnectUri = process.argv[2] ?? process.env.WALLETCONNECT_URI;

if (!walletConnectUri) {
  throw new Error("walletconnect URI is required: bun run test:walletconnect -- '<wc:...>'");
}

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

const payload = {
  uri: walletConnectUri,
};

const response = await signedFetch(
  endpoint,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  },
  signer,
);
const bodyText = await response.text();

console.log(`[walletconnect] status=${response.status}`);
console.log(`[walletconnect] body=${bodyText}`);
