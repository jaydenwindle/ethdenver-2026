import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const walletConnectPendingConnections = pgTable(
  "wallet_connect_pending_connections",
  {
    pairingTopic: text("pairing_topic").primaryKey(),
    owner: text("owner").$type<`0x${string}`>().notNull(),
    defaultChainId: integer("default_chain_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    expiresAtIdx: index("wallet_connect_pending_connections_expires_at_idx").on(table.expiresAt),
  }),
);

export const walletConnectSessions = pgTable(
  "wallet_connect_sessions",
  {
    topic: text("topic").primaryKey(),
    owner: text("owner").$type<`0x${string}`>().notNull(),
    address: text("address").$type<`0x${string}`>().notNull(),
    domain: text("domain"),
    defaultChainId: integer("default_chain_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    ownerIdx: index("wallet_connect_sessions_owner_idx").on(table.owner),
  }),
);

export const walletConnectSessionOperations = pgTable(
  "wallet_connect_session_operations",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    requestId: bigint("request_id", { mode: "number" }).notNull(),
    topic: text("topic").notNull(),
    method: text("method").notNull(),
    chainId: text("chain_id").notNull(),
    params: jsonb("params").$type<unknown>().notNull(),
    status: text("status").$type<"proposed" | "succeeded" | "failed">().notNull(),
    timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(),
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    topicIdx: index("wallet_connect_session_operations_topic_idx").on(table.topic),
    topicRequestIdUniqueIdx: uniqueIndex(
      "wallet_connect_session_operations_topic_request_id_unique_idx",
    ).on(table.topic, table.requestId),
    topicIdIdx: index("wallet_connect_session_operations_topic_id_idx").on(table.topic, table.id),
    idIdx: index("wallet_connect_session_operations_id_idx").on(table.id),
  }),
);
