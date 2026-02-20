# runtime

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

For local Postgres + Drizzle:

```bash
docker compose up -d postgres
bun run db:generate
bun run db:migrate
```

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
