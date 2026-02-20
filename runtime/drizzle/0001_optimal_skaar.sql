WITH ranked_operations AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY topic, request_id
      ORDER BY
        CASE status
          WHEN 'succeeded' THEN 1
          WHEN 'failed' THEN 2
          ELSE 3
        END,
        id DESC
    ) AS row_num
  FROM wallet_connect_session_operations
)
DELETE FROM wallet_connect_session_operations
WHERE id IN (
  SELECT id
  FROM ranked_operations
  WHERE row_num > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_connect_session_operations_topic_request_id_unique_idx" ON "wallet_connect_session_operations" USING btree ("topic","request_id");
