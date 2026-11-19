import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { joinSession } from "@github/copilot-sdk/extension";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const valueOptions = new Set(["-m", "--message", "-F", "--file", "--trailer"]);

// Only inspect command heads and their subcommands, never arbitrary argument text.
function hasCommitCommand(command) {
    const pending = [command];
    const separator = /^[;&|(){}\r\n]$/;
    const literal = (token = "") => /^(['"])[\s\S]*\1$/.test(token) ? token.slice(1, -1) : token;
    while (pending.length) {
        const tokens = pending.pop().match(/(?:[^\s;&|(){}'"]+|'[^']*'|"(?:\\.|[^"\\])*")+|[;&|(){}\r\n]/g) ?? [];
        let atCommand = true;
        for (let index = 0; index < tokens.length; index++) {
            if (separator.test(tokens[index])) {
                atCommand = true;
                continue;
            }
            if (!atCommand) continue;
            const executable = literal(tokens[index]).toLowerCase();
            if (/^[A-Za-z_]\w*=/.test(tokens[index]) || /^(?:env|command|exec)$/.test(executable)) continue;
            atCommand = false;
            let end = index + 1;
            while (end < tokens.length && !separator.test(tokens[end])) end++;
            if (/^(?:bash|sh|powershell|pwsh)$/.test(executable)) {
                const flag = tokens.slice(index + 1, end).findIndex((token) => /^-(?:[a-z]*c|command)$/i.test(token));
                if (flag !== -1 && index + flag + 2 < end) {
                    const body = tokens[index + flag + 2];
                    // Inspect only explicit command arguments, not ordinary quoted values.
                    // Each queued body is a shorter substring; no expansion or execution.
                    pending.push(literal(body) === body ? tokens.slice(index + flag + 2, end).join(" ") : literal(body));
                }
            }
            if (executable !== "git" && executable !== "npm") continue;
            let arg = index + 1;
            while (arg < end && literal(tokens[arg]).startsWith("-")) {
                const option = literal(tokens[arg++]);
                if (/^(?:-C|-c|--git-dir|--work-tree|--namespace|--config-env|--prefix|--workspace|-w)$/.test(option)) arg++;
            }
            if (executable === "git" && literal(tokens[arg]).toLowerCase() === "commit") return true;
            if (executable === "npm" && literal(tokens[arg]).toLowerCase() === "run" &&
                literal(tokens[arg + 1]).toLowerCase() === "commit") return true;
        }
    }
    return false;
}

// Lexical allowlist, not a shell parser. Never expand or execute token values.
function isStandaloneCommit(command) {
    // ASCII avoids PowerShell smart quotes; reject interpolation in either shell.
    if (/[^\t\x20-\x7e]|[$`]/.test(command)) return false;
    const text = command.trim();
    // Quotes must enclose a whole token. Backslashes cannot escape an enclosing quote.
    const token = /(?:"([^"$`\\]*(?:\\[^"$`][^"$`\\]*)*)"|'([^'$`\\]*(?:\\[^'$`][^'$`\\]*)*)'|([-A-Za-z0-9_.\/:]+))(?:[ \t]+|$)/y;
    const tokens = [];
    while (token.lastIndex < text.length) {
        const match = token.exec(text);
        if (!match) return false;
        tokens.push({ value: match[1] ?? match[2] ?? match[3], quoted: match[3] === undefined });
    }

    const keyword = (index, value) =>
        tokens[index] && !tokens[index].quoted && tokens[index].value.toLowerCase() === value;
    let index;
    if (keyword(0, "git") && keyword(1, "commit")) {
        index = 2;
    } else if (keyword(0, "npm") && keyword(1, "run") && keyword(2, "commit")) {
        index = 3;
        if (tokens.length > index) {
            if (!keyword(index, "--")) return false;
            index++;
        }
    } else {
        return false;
    }

    for (; index < tokens.length; index += 2) {
        const option = tokens[index];
        const value = tokens[index + 1];
        if (option.quoted || !valueOptions.has(option.value) || !value) return false;
        // Literal Windows paths are allowed only as message-file values.
        if (value.value.includes("\\") && option.value !== "-F" && option.value !== "--file") return false;
    }
    return true;
}

await joinSession({
    hooks: {
        onPreToolUse: async (input) => {
            if (input.toolName !== "powershell" && input.toolName !== "bash") return;
            const command = String(input.toolArgs?.command ?? "");
            if (!hasCommitCommand(command)) return;
            if (!isStandaloneCommit(command)) {
                return {
                    permissionDecision: "deny",
                    permissionDecisionReason: "Only standalone `git commit` or `npm run commit` invocations with literal ASCII values for -m/--message, -F/--file and --trailer are supported. Use a session rooted in the target worktree, stage source and regression tests in a separate tool call, then run `npm run commit` alone. Compound commands, directory changes, target overrides, shell expansion and other options are not supported.",
                };
            }
            const files = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
                cwd: repositoryRoot,
                encoding: "utf8",
                windowsHide: true,
            }).trim().split(/\r?\n/);
            const hasSource = files.some((file) => /^src\/(?!__tests__\/).*\.tsx?$/.test(file));
            const hasTests = files.some((file) => /^src\/__tests__\/.*\.test\.tsx?$/.test(file));
            if (hasSource && !hasTests) {
                return {
                    permissionDecision: "deny",
                    permissionDecisionReason: "Source changes require staged regression tests before committing. This hook checks the index before this shell command runs, so any staging in it has not run yet. Stage source and regression tests in a separate tool call, then run `npm run commit` in a new tool call.",
                };
            }
        },
    },
});
