# cli

Bun-based starter for the pi Coding Agent SDK.

## Install

```bash
bun install
```

## Configure credentials

The SDK resolves model credentials from runtime keys, `~/.pi/agent/auth.json`, or environment variables.

Set at least one supported provider key before running:

```bash
export ANTHROPIC_API_KEY="your-key"
# or
export OPENAI_API_KEY="your-key"
```

## Run

```bash
bun run index.ts agent "What files are in the current directory?"
```

If you omit the prompt argument on `agent`, it defaults to:

`What files are in the current directory?`

To see available commands:

```bash
bun run index.ts --help
```
