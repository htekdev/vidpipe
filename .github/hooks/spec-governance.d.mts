interface HookEvent {
  cwd?: string;
  toolName: string;
  toolArgs?: string | Record<string, string>;
}

interface HookResult {
  permissionDecision?: 'deny';
  permissionDecisionReason?: string;
  additionalContext?: string;
}

/** Evaluate a spec governance event using staged changes from its working directory. */
export function evaluateHook(event: HookEvent, phase: 'pre' | 'post'): HookResult;

/** Parse hook stdin and return protocol output or an actionable diagnostic. */
export function runHook(input: string, phase: 'pre' | 'post'): { output: string; diagnostic: string };
