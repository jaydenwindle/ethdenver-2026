import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { Command } from "commander";

const DEFAULT_PROMPT = "What files are in the current directory?";

async function runAgent(promptParts: string[]) {
  const promptText = promptParts.join(" ").trim() || DEFAULT_PROMPT;
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
  });

  session.subscribe((event) => {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  });

  try {
    await session.prompt(promptText);
  } finally {
    session.dispose();
  }
}

const program = new Command();

program
  .name("cli")
  .description("Bun CLI for pi coding agent workflows")
  .showHelpAfterError()
  .showSuggestionAfterError();

program
  .command("agent")
  .description("Run the pi coding agent and stream all events")
  .argument("[prompt...]", "prompt text to send to the agent")
  .action(async (promptParts: string[]) => {
    await runAgent(promptParts);
  });

if (process.argv.length <= 2) {
  program.help();
}

await program.parseAsync(process.argv);
