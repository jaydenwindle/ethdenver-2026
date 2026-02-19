import { call } from "@orpc/server";
import { signRequest, type EthHttpSigner } from "@slicekit/erc8128";
import { getAddress } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";

const getKeyMock = vi.fn<(path: string) => Promise<any>>(async (_path: string) => {
  throw new Error("getKey mock not initialized");
});

vi.mock("@phala/dstack-sdk", () => {
  return {
    DstackClient: class {
      async getKey(path: string) {
        return getKeyMock(path);
      }
    },
  };
});

import { createEthAccount } from "./createEthAccount";

const FORGE_TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

describe("createEthAccount procedure", () => {
  afterEach(() => {
    getKeyMock.mockReset();
  });

  it("rejects unsigned requests and accepts ERC-8128 signed requests", async () => {
    const signerAccount = mnemonicToAccount(FORGE_TEST_MNEMONIC, {
      accountIndex: 0,
    });
    const dstackWallet = mnemonicToAccount(FORGE_TEST_MNEMONIC, {
      accountIndex: 1,
    });
    const dstackPrivateKey = dstackWallet.getHdKey().privateKey;

    if (!dstackPrivateKey) {
      throw new Error("expected test mnemonic account private key");
    }

    getKeyMock.mockImplementation(async (_path: string) => {
      return {
        __name__: "GetKeyResponse" as const,
        key: dstackPrivateKey,
        signature_chain: [] as Uint8Array[],
      };
    });

    const unsignedRequest = new Request("http://localhost:8000/api/v1/accounts", {
      method: "POST",
    });

    await expect(
      call(createEthAccount, undefined, {
        context: { request: unsignedRequest },
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      data: {
        reason: "ERC8128_VERIFICATION_FAILED",
        verificationReason: "missing_headers",
      },
    });

    const signer: EthHttpSigner = {
      address: signerAccount.address,
      chainId: 1,
      signMessage: async (message) => {
        return signerAccount.signMessage({ message: { raw: message } });
      },
    };

    const signedRequest = await signRequest(
      "http://localhost:8000/api/v1/accounts",
      { method: "POST" },
      signer,
    );

    await expect(
      call(createEthAccount, undefined, {
        context: { request: signedRequest },
      }),
    ).resolves.toEqual({
      owner: getAddress(signerAccount.address),
      address: getAddress(dstackWallet.address),
    });

    expect(getKeyMock).toHaveBeenCalledWith(
      `wallet/ethereum/${getAddress(signerAccount.address)}`,
    );
  });
});
