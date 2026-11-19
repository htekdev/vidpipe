import { execFileSync } from "node:child_process";
import { joinSession } from "@github/copilot-sdk/extension";

await joinSession({
    hooks: {
        onPreToolUse: async (input) => {
            if (input.toolName !== "powershell" && input.toolName !== "bash") return;
            const command = String(input.toolArgs?.command ?? "");
            if (!/\b(?:git\s+commit|npm\s+run\s+commit)\b/.test(command)) return;
            const files = execFileSync("git", ["diff", "--cached", "--name-only"], {
                encoding: "utf8",
                windowsHide: true,
            }).trim().split(/\r?\n/);
            const hasSource = files.some((file) => /^src\/(?!__tests__\/).*\.tsx?$/.test(file));
            const hasTests = files.some((file) => /^src\/__tests__\/.*\.test\.tsx?$/.test(file));
            if (hasSource && !hasTests) {
                return {
                    permissionDecision: "deny",
                    permissionDecisionReason: "Source changes require staged regression tests before committing.",
                };
            }
        },
    },
});
