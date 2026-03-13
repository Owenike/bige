export type SafeCommand = {
  executable: string;
  args: string[];
};

const allowedExecutables = new Set(["node", "npm", "git"]);
const blockedGitSubcommands = new Set(["push", "reset", "checkout", "clean", "rebase", "merge"]);

export function validateAllowListedCommand(command: string[]) {
  if (command.length === 0) throw new Error("Executor requires a non-empty command.");
  const [executable, ...args] = command;
  if (!allowedExecutables.has(executable)) {
    throw new Error(`Executor blocked command "${executable}".`);
  }

  if (executable === "git" && args.some((arg) => blockedGitSubcommands.has(arg))) {
    throw new Error(`Executor blocked risky git command: ${command.join(" ")}.`);
  }

  if (executable === "npm" && args[0] !== "run") {
    throw new Error(`Executor only allows "npm run ...", received: ${command.join(" ")}.`);
  }

  return {
    executable,
    args,
  } satisfies SafeCommand;
}
