import { DstackClient } from "@phala/dstack-sdk";
import { toViemAccount } from "@phala/dstack-sdk/viem";
import { Core } from "@walletconnect/core";
import { formatJsonRpcError, formatJsonRpcResult } from "@walletconnect/jsonrpc-utils";
import { getSdkError } from "@walletconnect/utils";
import { parseUri } from "@walletconnect/utils";
import { Web3Wallet } from "@walletconnect/web3wallet";
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { createWalletClient, hexToBytes, http, isHex } from "viem";
import * as viemChains from "viem/chains";

import { db } from "../db/client";
import {
  walletConnectPendingConnections,
  walletConnectSessionOperations,
  walletConnectSessions,
} from "../db/schema";

type ConnectWalletParams = {
  owner: `0x${string}`;
  uri: string;
};

type ConnectKickoffResult = {
  topic: string;
  address: `0x${string}`;
  status: "pairing_started";
};

type SessionSignerRecord = {
  owner: `0x${string}`;
  address: `0x${string}`;
  domain?: string;
  defaultChainId: number;
};

type PendingConnectionRecord = {
  owner: `0x${string}`;
  defaultChainId: number;
};

type Wallet = Awaited<ReturnType<typeof Web3Wallet.init>>;

export type WalletSessionSummary = {
  topic: string;
  owner: `0x${string}`;
  address: `0x${string}`;
  domain?: string;
  defaultChainId: number;
};

export type WalletSessionOperation = {
  id: number;
  topic: string;
  method: string;
  chainId: string;
  params: unknown;
  status: "proposed" | "succeeded" | "failed";
  timestamp: number;
  result?: unknown;
  error?: string;
};

let walletPromise: Promise<Wallet> | undefined;
const PENDING_TTL_SECONDS = 300;
const MAX_OPERATION_RECORDS = 500;

const EIP155_METHODS = [
  "eth_sendTransaction",
  "eth_signTransaction",
  "eth_sign",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "eth_accounts",
  "eth_requestAccounts",
] as const;

const EIP155_EVENTS = ["accountsChanged", "chainChanged"] as const;

const SIGNING_OR_EXECUTION_METHODS = new Set<string>([
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "eth_signTransaction",
  "eth_sendTransaction",
]);

export async function createWalletSession({ owner, uri }: ConnectWalletParams) {
  const pairingTopic = parseUri(uri).topic;

  if (await getPendingConnection(pairingTopic)) {
    throw new Error(`pairing already pending for topic ${pairingTopic}`);
  }

  console.log("[walletconnect] connect requested", { owner, pairingTopic, uri });

  const account = await deriveAccount(owner);

  await setPendingConnection(pairingTopic, {
    owner,
    defaultChainId: 1,
  });

  const wallet = await getWallet();

  console.log("[walletconnect] pairing started", {
    owner,
    pairingTopic,
    address: account.address,
  });

  try {
    await wallet.pair({ uri });
  } catch (error) {
    await deletePendingConnection(pairingTopic);
    throw error;
  }

  const kickoff = {
    topic: pairingTopic,
    address: account.address,
    status: "pairing_started" as const,
  };

  console.log("[walletconnect] pairing initiated", kickoff);

  return kickoff;
}

export async function listWalletSessions(owner?: `0x${string}`): Promise<WalletSessionSummary[]> {
  const rows = owner
    ? await db
        .select()
        .from(walletConnectSessions)
        .where(eq(walletConnectSessions.owner, owner))
        .orderBy(desc(walletConnectSessions.createdAt))
    : await db.select().from(walletConnectSessions).orderBy(desc(walletConnectSessions.createdAt));

  return rows.map((row) => ({
    topic: row.topic,
    owner: row.owner,
    address: row.address,
    domain: row.domain ?? undefined,
    defaultChainId: row.defaultChainId,
  }));
}

export async function listWalletSessionOperations(
  owner?: `0x${string}`,
  topic?: string,
): Promise<WalletSessionOperation[]> {
  const filters: SQL[] = [];

  if (topic) {
    filters.push(eq(walletConnectSessionOperations.topic, topic));
  }

  if (owner) {
    filters.push(eq(walletConnectSessions.owner, owner));
  }

  const rows = await db
    .select({
      id: walletConnectSessionOperations.requestId,
      topic: walletConnectSessionOperations.topic,
      method: walletConnectSessionOperations.method,
      chainId: walletConnectSessionOperations.chainId,
      params: walletConnectSessionOperations.params,
      status: walletConnectSessionOperations.status,
      timestamp: walletConnectSessionOperations.timestampMs,
      result: walletConnectSessionOperations.result,
      error: walletConnectSessionOperations.error,
    })
    .from(walletConnectSessionOperations)
    .leftJoin(
      walletConnectSessions,
      eq(walletConnectSessions.topic, walletConnectSessionOperations.topic),
    )
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(walletConnectSessionOperations.id))
    .limit(MAX_OPERATION_RECORDS);

  return rows.map((row) => ({
    id: row.id,
    topic: row.topic,
    method: row.method,
    chainId: row.chainId,
    params: row.params,
    status: row.status,
    timestamp: row.timestamp,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
  }));
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

  wallet.on("session_proposal", async (proposal: any) => {
    await onSessionProposal(wallet, proposal);
  });

  wallet.on("session_request", async (event: any) => {
    await onSessionRequest(wallet, event);
  });

  wallet.on("session_delete", (event: any) => {
    console.log("[walletconnect] session deleted", { topic: event.topic });
    void deleteSessionSigner(event.topic as string);
  });

  return wallet;
}

async function onSessionProposal(wallet: Wallet, proposal: any) {
  const pairingTopic = proposal.params.pairingTopic as string | undefined;

  console.log("[walletconnect] session proposal received", {
    id: proposal.id,
    pairingTopic,
    proposer: proposal.params.proposer?.metadata?.name,
    requiredNamespaces: proposal.params.requiredNamespaces,
    optionalNamespaces: proposal.params.optionalNamespaces,
  });

  const pending = pairingTopic ? await getPendingConnection(pairingTopic) : undefined;

  if (!pending) {
    await wallet.rejectSession({
      id: proposal.id,
      reason: getSdkError("USER_REJECTED"),
    });

    return;
  }

  try {
    const account = await deriveAccount(pending.owner);
    const approvedChainIds = resolveApprovedChainIds(proposal, pending.defaultChainId);

    if (approvedChainIds.length === 0) {
      throw new Error("no supported eip155 chains in session proposal");
    }

    const defaultChainId = approvedChainIds[0]!;

    const session = await wallet.approveSession({
      id: proposal.id,
      namespaces: {
        eip155: {
          methods: [...EIP155_METHODS],
          events: [...EIP155_EVENTS],
          accounts: approvedChainIds.map(
            (chainId) => `eip155:${chainId}:${account.address}`,
          ),
        },
      },
    });

    await setSessionSigner(session.topic, {
      owner: pending.owner,
      address: account.address,
      domain: extractDomain(proposal.params.proposer?.metadata?.url),
      defaultChainId,
    });
    await deletePendingConnection(pairingTopic!);

    console.log("[walletconnect] session approved", {
      topic: session.topic,
      chainId: defaultChainId,
      address: account.address,
    });

  } catch (error) {
    if (pairingTopic) {
      await deletePendingConnection(pairingTopic);
    }

    const message = error instanceof Error ? error.message : "unknown error";

    console.error("[walletconnect] session approval failed", {
      id: proposal.id,
      pairingTopic,
      error: message,
    });

    await wallet.rejectSession({
      id: proposal.id,
      reason: getSdkError("USER_REJECTED"),
    });
  }
}

async function onSessionRequest(wallet: Wallet, event: any) {
  const topic = event.topic as string;
  const method = event.params.request.method as string;
  const chainId = String(event.params.chainId ?? "");
  const params = event.params.request.params;
  const signerRecord = await getSessionSigner(topic);

  if (!signerRecord) {
    await wallet.respondSessionRequest({
      topic,
      response: formatJsonRpcError(event.id, {
        code: 5000,
        message: "unknown WalletConnect session",
      }),
    });

    return;
  }

  if (isSigningOrExecutionMethod(method)) {
    await appendOperation(topic, {
      id: event.id,
      topic,
      method,
      chainId,
      params,
      status: "proposed",
      timestamp: Date.now(),
    });

    console.log("[walletconnect] incoming request", {
      topic,
      id: event.id,
      chainId,
      method,
      params,
    });
  }

  try {
    const signer = {
      account: await deriveAccount(signerRecord.owner),
      defaultChainId: signerRecord.defaultChainId,
    };

    const result = await handleSessionRequest(event, signer);

    if (isSigningOrExecutionMethod(method)) {
      await appendOperation(topic, {
        id: event.id,
        topic,
        method,
        chainId,
        params,
        status: "succeeded",
        timestamp: Date.now(),
        result,
      });

      console.log("[walletconnect] request result", {
        topic,
        id: event.id,
        method,
        result,
      });
    }

    await wallet.respondSessionRequest({
      topic,
      response: formatJsonRpcResult(event.id, result),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";

    if (isSigningOrExecutionMethod(method)) {
      await appendOperation(topic, {
        id: event.id,
        topic,
        method,
        chainId,
        params,
        status: "failed",
        timestamp: Date.now(),
        error: message,
      });

      console.error("[walletconnect] request error", {
        topic,
        id: event.id,
        method,
        error: message,
      });
    }

    await wallet.respondSessionRequest({
      topic,
      response: formatJsonRpcError(event.id, {
        code: 5001,
        message,
      }),
    });
  }
}

async function handleSessionRequest(event: any, signer: ResolvedSessionSigner) {
  const method = event.params.request.method as string;
  const params = event.params.request.params;
  const requestChainId = extractChainId(event.params.chainId as string | undefined);
  const chainId = requestChainId ?? signer.defaultChainId;

  if (method === "eth_accounts" || method === "eth_requestAccounts") {
    return [signer.account.address];
  }

  if (method === "personal_sign") {
    return signer.account.signMessage({
      message: toSignableMessage(params[0]),
    });
  }

  if (method === "eth_sign") {
    return signer.account.signMessage({
      message: toSignableMessage(params[1]),
    });
  }

  if (method === "eth_signTypedData_v4" || method === "eth_signTypedData") {
    const typedData =
      typeof params[1] === "string" ? JSON.parse(params[1] as string) : params[1];

    return signer.account.signTypedData(typedData as any);
  }

  if (method === "eth_signTransaction" || method === "eth_sendTransaction") {
    const walletClient = makeWalletClient(signer, chainId);

    return walletClient.request({
      method,
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

type ResolvedSessionSigner = {
  account: ReturnType<typeof toViemAccount>;
  defaultChainId: number;
};

async function deriveAccount(owner: `0x${string}`) {
  const dstack = new DstackClient();
  const key = await dstack.getKey(`wallet/ethereum/${owner}`);

  return toViemAccount(key);
}

async function setPendingConnection(pairingTopic: string, record: PendingConnectionRecord) {
  await db
    .insert(walletConnectPendingConnections)
    .values({
      pairingTopic,
      owner: record.owner,
      defaultChainId: record.defaultChainId,
      expiresAt: new Date(Date.now() + PENDING_TTL_SECONDS * 1000),
    })
    .onConflictDoUpdate({
      target: walletConnectPendingConnections.pairingTopic,
      set: {
        owner: record.owner,
        defaultChainId: record.defaultChainId,
        expiresAt: new Date(Date.now() + PENDING_TTL_SECONDS * 1000),
      },
    });
}

async function getPendingConnection(pairingTopic: string): Promise<PendingConnectionRecord | undefined> {
  await db
    .delete(walletConnectPendingConnections)
    .where(lte(walletConnectPendingConnections.expiresAt, new Date()));

  const row = await db.query.walletConnectPendingConnections.findFirst({
    where: and(
      eq(walletConnectPendingConnections.pairingTopic, pairingTopic),
      gt(walletConnectPendingConnections.expiresAt, new Date()),
    ),
  });

  if (!row) {
    return undefined;
  }

  return {
    owner: row.owner,
    defaultChainId: row.defaultChainId,
  };
}

async function deletePendingConnection(pairingTopic: string) {
  await db
    .delete(walletConnectPendingConnections)
    .where(eq(walletConnectPendingConnections.pairingTopic, pairingTopic));
}

async function setSessionSigner(topic: string, record: SessionSignerRecord) {
  await db
    .insert(walletConnectSessions)
    .values({
      topic,
      owner: record.owner,
      address: record.address,
      domain: record.domain,
      defaultChainId: record.defaultChainId,
    })
    .onConflictDoUpdate({
      target: walletConnectSessions.topic,
      set: {
        owner: record.owner,
        address: record.address,
        domain: record.domain,
        defaultChainId: record.defaultChainId,
      },
    });
}

async function getSessionSigner(topic: string): Promise<SessionSignerRecord | undefined> {
  const row = await db.query.walletConnectSessions.findFirst({
    where: eq(walletConnectSessions.topic, topic),
  });

  if (!row) {
    return undefined;
  }

  return {
    owner: row.owner,
    address: row.address,
    domain: row.domain ?? undefined,
    defaultChainId: row.defaultChainId,
  };
}

async function deleteSessionSigner(topic: string) {
  await db.delete(walletConnectSessions).where(eq(walletConnectSessions.topic, topic));
}

async function appendOperation(topic: string, operation: WalletSessionOperation) {
  await db.transaction(async (tx) => {
    await tx
      .insert(walletConnectSessionOperations)
      .values({
        requestId: operation.id,
        topic,
        method: operation.method,
        chainId: operation.chainId,
        params: operation.params,
        status: operation.status,
        timestampMs: operation.timestamp,
        result: operation.result,
        error: operation.error,
      })
      .onConflictDoUpdate({
        target: [walletConnectSessionOperations.topic, walletConnectSessionOperations.requestId],
        set: {
          method: operation.method,
          chainId: operation.chainId,
          params: operation.params,
          status: operation.status,
          timestampMs: operation.timestamp,
          result: operation.result,
          error: operation.error,
        },
      });

    await tx.execute(sql`
      delete from ${walletConnectSessionOperations}
      where ${walletConnectSessionOperations.id} in (
        select ${walletConnectSessionOperations.id}
        from ${walletConnectSessionOperations}
        order by ${walletConnectSessionOperations.id} desc
        offset ${MAX_OPERATION_RECORDS}
      )
    `);

    await tx.execute(sql`
      delete from ${walletConnectSessionOperations}
      where ${walletConnectSessionOperations.topic} = ${topic}
        and ${walletConnectSessionOperations.id} in (
          select ${walletConnectSessionOperations.id}
          from ${walletConnectSessionOperations}
          where ${walletConnectSessionOperations.topic} = ${topic}
          order by ${walletConnectSessionOperations.id} desc
          offset ${MAX_OPERATION_RECORDS}
        )
    `);
  });
}

function makeWalletClient(signer: ResolvedSessionSigner, chainId: number) {
  const chain = resolveViemChain(chainId);

  if (!chain) {
    throw new Error(`unsupported chain ${chainId}: no viem default RPC available`);
  }

  const rpcUrl = chain.rpcUrls.default.http[0];

  if (!rpcUrl) {
    throw new Error(`unsupported chain ${chainId}: no default HTTP RPC URL`);
  }

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

function resolveApprovedChainIds(proposal: any, fallbackChainId: number): number[] {
  const requiredChains = proposal.params.requiredNamespaces?.eip155?.chains;
  const optionalChains = proposal.params.optionalNamespaces?.eip155?.chains;

  const candidateChains = [
    ...(Array.isArray(requiredChains) ? requiredChains : []),
    ...(Array.isArray(optionalChains) ? optionalChains : []),
  ];

  const supported = [...new Set(candidateChains)]
    .map((chain) => extractChainId(chain))
    .filter((value): value is number => value !== undefined)
    .filter((chainId) => Boolean(resolveViemChain(chainId)));

  if (supported.length > 0) {
    return supported;
  }

  return resolveViemChain(fallbackChainId) ? [fallbackChainId] : [];
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

function extractDomain(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

function toSignableMessage(raw: unknown) {
  if (typeof raw !== "string") {
    throw new Error("invalid signing payload");
  }

  return isHex(raw) ? { raw: hexToBytes(raw) } : raw;
}

function isSigningOrExecutionMethod(method: string): boolean {
  return SIGNING_OR_EXECUTION_METHODS.has(method);
}
