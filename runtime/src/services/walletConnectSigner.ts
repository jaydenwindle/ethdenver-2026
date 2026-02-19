import { DstackClient } from "@phala/dstack-sdk";
import { toViemAccount } from "@phala/dstack-sdk/viem";
import { Core } from "@walletconnect/core";
import { getSdkError } from "@walletconnect/utils";
import { Web3Wallet } from "@walletconnect/web3wallet";
import { createWalletClient, hexToBytes, http, isHex } from "viem";
import * as viemChains from "viem/chains";

type ConnectWalletParams = {
  owner: `0x${string}`;
  uri: string;
};

type PendingConnection = {
  signer: SessionSigner;
  resolve: (value: {
    topic: string;
    address: `0x${string}`;
    chainId: number;
  }) => void;
  reject: (reason?: unknown) => void;
};

type SessionSigner = {
  owner: `0x${string}`;
  account: ReturnType<typeof toViemAccount>;
  chainId: number;
};

const pendingConnections: PendingConnection[] = [];
const sessionSigners = new Map<string, SessionSigner>();
let walletPromise: Promise<any> | undefined;
let requestHandlersBound = false;

export async function connectWalletSession({
  owner,
  uri,
}: ConnectWalletParams) {
  console.log("[walletconnect] connect requested", {
    owner,
    uri,
  });

  const dstack = new DstackClient();
  const key = await dstack.getKey(`wallet/ethereum/${owner}`);
  const account = toViemAccount(key);

  const signer: SessionSigner = {
    owner,
    account,
    chainId: 1,
  };

  const wallet = await getWallet();

  const approval = await new Promise<{
    topic: string;
    address: `0x${string}`;
    chainId: number;
  }>((resolve, reject) => {
    pendingConnections.push({ signer, resolve, reject });

    console.log("[walletconnect] pairing started", {
      owner,
      address: account.address,
    });

    void wallet.pair({ uri }).catch((error: unknown) => {
      const index = pendingConnections.findIndex((item) => item.reject === reject);

      if (index >= 0) {
        pendingConnections.splice(index, 1);
      }

      reject(error);
    });
  });

  console.log("[walletconnect] connected", approval);

  return approval;
}

async function getWallet() {
  if (!walletPromise) {
    walletPromise = initWallet();
  }

  return walletPromise;
}

async function initWallet() {
  const projectId = process.env.WALLETCONNECT_PROJECT_ID;

  if (!projectId) {
    throw new Error("WALLETCONNECT_PROJECT_ID is required");
  }

  const core = new Core({ projectId });
  const wallet = await Web3Wallet.init({
    core: core as any,
    metadata: {
      name: "dstack wallet signer",
      description: "WalletConnect signer backed by dstack key derivation",
      url: "https://localhost",
      icons: [],
    },
  });

  if (!requestHandlersBound) {
    wallet.on("session_proposal", async (proposal: any) => {
      console.log("[walletconnect] session proposal received", {
        id: proposal.id,
        proposer: proposal.params.proposer?.metadata?.name,
        requiredNamespaces: proposal.params.requiredNamespaces,
        optionalNamespaces: proposal.params.optionalNamespaces,
      });

      const pending = pendingConnections.shift();

      if (!pending) {
        await wallet.rejectSession({
          id: proposal.id,
          reason: getSdkError("USER_REJECTED"),
        });

        return;
      }

      try {
        const proposalChains = proposal.params.requiredNamespaces?.eip155?.chains;
        const proposalChainId = extractChainId(proposalChains?.[0]);
        const resolvedChainId = proposalChainId ?? pending.signer.chainId;

        if (!resolveViemChain(resolvedChainId)) {
          throw new Error(`unsupported chain ${resolvedChainId}: no viem default RPC available`);
        }

        const session = await wallet.approveSession({
          id: proposal.id,
          namespaces: {
            eip155: {
              methods: [
                "eth_sendTransaction",
                "eth_signTransaction",
                "eth_sign",
                "personal_sign",
                "eth_signTypedData",
                "eth_signTypedData_v4",
                "eth_accounts",
                "eth_requestAccounts",
              ],
              events: ["accountsChanged", "chainChanged"],
              accounts: [`eip155:${resolvedChainId}:${pending.signer.account.address}`],
            },
          },
        });

        sessionSigners.set(session.topic, {
          ...pending.signer,
          chainId: resolvedChainId,
        });

        console.log("[walletconnect] session approved", {
          topic: session.topic,
          chainId: resolvedChainId,
          address: pending.signer.account.address,
        });

        pending.resolve({
          topic: session.topic,
          address: pending.signer.account.address,
          chainId: resolvedChainId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";

        console.error("[walletconnect] session approval failed", {
          id: proposal.id,
          error: message,
        });

        pending.reject(error);
      }
    });

    wallet.on("session_request", async (event: any) => {
      const signer = sessionSigners.get(event.topic);
      const method = event.params.request.method as string;

      if (!signer) {
        await wallet.respondSessionRequest({
          topic: event.topic,
          response: rpcError(event.id, 5000, "unknown WalletConnect session"),
        });

        return;
      }

      if (isSigningOrExecutionMethod(method)) {
        console.log("[walletconnect] incoming request", {
          topic: event.topic,
          id: event.id,
          chainId: event.params.chainId,
          method,
          params: event.params.request.params,
        });
      }

      try {
        const result = await handleSessionRequest(event, signer);

        if (isSigningOrExecutionMethod(method)) {
          console.log("[walletconnect] request result", {
            topic: event.topic,
            id: event.id,
            method,
            result,
          });
        }

        await wallet.respondSessionRequest({
          topic: event.topic,
          response: rpcResult(event.id, result),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "request failed";

        if (isSigningOrExecutionMethod(method)) {
          console.error("[walletconnect] request error", {
            topic: event.topic,
            id: event.id,
            method,
            error: message,
          });
        }

        await wallet.respondSessionRequest({
          topic: event.topic,
          response: rpcError(event.id, 5001, message),
        });
      }
    });

    wallet.on("session_delete", (event: any) => {
      console.log("[walletconnect] session deleted", {
        topic: event.topic,
      });

      sessionSigners.delete(event.topic);
    });

    requestHandlersBound = true;
  }

  return wallet;
}

async function handleSessionRequest(event: any, signer: SessionSigner) {
  const method = event.params.request.method as string;
  const params = event.params.request.params;

  if (method === "eth_accounts" || method === "eth_requestAccounts") {
    return [signer.account.address];
  }

  if (method === "personal_sign") {
    const raw = params[0] as string;

    return signer.account.signMessage({
      message: isHex(raw) ? { raw: hexToBytes(raw) } : raw,
    });
  }

  if (method === "eth_sign") {
    const raw = params[1] as string;

    return signer.account.signMessage({
      message: isHex(raw) ? { raw: hexToBytes(raw) } : raw,
    });
  }

  if (method === "eth_signTypedData_v4" || method === "eth_signTypedData") {
    const typedData = JSON.parse(params[1] as string);

    return signer.account.signTypedData(typedData as any);
  }

  if (method === "eth_signTransaction") {
    const walletClient = makeWalletClient(signer);

    return walletClient.request({
      method: "eth_signTransaction",
      params: [
        {
          ...(params[0] as Record<string, unknown>),
          from: signer.account.address,
        },
      ],
    });
  }

  if (method === "eth_sendTransaction") {
    const walletClient = makeWalletClient(signer);

    return walletClient.request({
      method: "eth_sendTransaction",
      params: [
        {
          ...(params[0] as Record<string, unknown>),
          from: signer.account.address,
        },
      ],
    });
  }

  throw new Error(`unsupported WalletConnect method: ${method}`);
}

function makeWalletClient(signer: SessionSigner) {
  const viemChain = resolveViemChain(signer.chainId);

  if (!viemChain) {
    throw new Error(`unsupported chain ${signer.chainId}: no viem default RPC available`);
  }

  const rpcUrl = viemChain.rpcUrls.default.http[0];

  const chain = viemChain;

  return createWalletClient({
    account: signer.account,
    chain,
    transport: http(rpcUrl),
  });
}

function resolveViemChain(chainId: number) {
  for (const value of Object.values(viemChains)) {
    const chain = value as any;

    if (chain?.id === chainId && Array.isArray(chain?.rpcUrls?.default?.http)) {
      return chain;
    }
  }

  return undefined;
}

function extractChainId(chain: string | undefined) {
  if (!chain) {
    return undefined;
  }

  const parts = chain.split(":");

  if (parts.length !== 2 || parts[0] !== "eip155") {
    return undefined;
  }

  const chainId = Number(parts[1]);

  if (!Number.isInteger(chainId) || chainId <= 0) {
    return undefined;
  }

  return chainId;
}

function rpcResult(id: number, result: unknown) {
  return {
    id,
    jsonrpc: "2.0" as const,
    result,
  };
}

function rpcError(id: number, code: number, message: string) {
  return {
    id,
    jsonrpc: "2.0" as const,
    error: {
      code,
      message,
    },
  };
}

function isSigningOrExecutionMethod(method: string): boolean {
  return (
    method === "personal_sign" ||
    method === "eth_sign" ||
    method === "eth_signTypedData" ||
    method === "eth_signTypedData_v4" ||
    method === "eth_signTransaction" ||
    method === "eth_sendTransaction"
  );
}
