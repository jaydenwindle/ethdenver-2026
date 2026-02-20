---
name: walletconnect-login
description: Automates WalletConnect sign-in by clicking "Copy link" in the WalletConnect modal, reading the `wc:` URI from clipboard, and submitting it to the runtime API via ERC-8128 signed fetch.
allowed-tools: Bash(playwright-cli:*), Bash(bun:*), Bash(docker:*), Read, Glob
---

# WalletConnect Login Automation

Use this when an agent needs to log into a website using WalletConnect:

1. Open a dapp page in browser automation.
2. Click "Copy link" in the WalletConnect modal.
3. Read the WalletConnect URI (`wc:...`) from clipboard.
4. Pass that URI to the runtime service using ERC-8128 signed fetch.

## Preconditions

- Runtime API is running (`bun run dev` in `runtime/`).
- Postgres migrations are applied (`bun run db:migrate` in `runtime/`).
- The target site exposes a WalletConnect modal with a visible "Copy link" action.

## Recommended flow

### 1) Open and navigate

```bash
playwright-cli open "https://<your-dapp-connect-page>"
playwright-cli snapshot
```

Always run the browser in headed mode for this workflow (never headless).

From the page, trigger wallet auth in this order:

- click `Connect`, `Connect Wallet`, or `Login` (or equivalent primary auth CTA),
- then choose `WalletConnect` from the wallet options list,
- confirm the WalletConnect modal is open before continuing.

Use `snapshot` between actions to identify the correct clickable element refs.

### 2) Click "Copy link"

Run this once the WalletConnect modal is visible:

```bash
playwright-cli snapshot
# Use the element ref for the "Copy link" button from the snapshot.
playwright-cli click <copy-link-element-ref>
```

### 3) Read WalletConnect URI from clipboard

Grant clipboard permissions before reading:

```bash
playwright-cli run-code "async page => {
  const origin = await page.evaluate(() => window.location.origin);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  return origin;
}"
```

```bash
playwright-cli eval "navigator.clipboard.readText()"
```

Use the returned value only if it starts with `wc:`.

If clipboard read fails or returns empty:

- ensure the page is focused and secure (`https://`),
- click "Copy link" again,
- retry `navigator.clipboard.readText()`.

### 4) Submit URI with ERC-8128 signed fetch

From `runtime/`:

```bash
bun run walletconnect:login -- "<wc:...>"
```

Optional base URL override:

```bash
API_BASE_URL="http://localhost:8000" bun run walletconnect:login -- "<wc:...>"
```

### 5) Verify login kickoff

The script should print:

- `status=200` (or another success status your API contract returns)
- a response body containing `pairing_started` and `topic`

## Notes for agents

- Always close browser sessions when done: `playwright-cli close`.
- Prefer deterministic UI actions in the modal and always use the "Copy link" path.
- Treat missing `wc:` clipboard value as a recoverable state: click copy again, then retry clipboard read.

## Safety after login

- Once WalletConnect login is active, all signature requests and transactions triggered by actions in the app will be automatically approved and executed.
- Be deliberate with every click after login; avoid actions that can move funds, change approvals, or modify account state unless explicitly required.
