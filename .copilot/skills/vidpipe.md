# VidPipe CLI skill

Use this skill when the user asks to create ideas, inspect the idea board, or manage publishing schedule drift in VidPipe.

## Migration note (replace extension wrapper)

If an old extension exists at `~/.copilot/extensions/vidpipe`, remove it and use shell commands directly:

```bash
rm -rf ~/.copilot/extensions/vidpipe
```

Then run VidPipe through shell commands (`npx vidpipe ...`) instead of extension-wrapped tools.

## How to run

- Run from the VidPipe repository root.
- Prefer:

```bash
npx vidpipe <subcommand> [flags]
```

## Decision guidance

- Use `ideate --add --topic "..." --no-ai` for a fast deterministic draft when the user already knows the topic and does not need research/enrichment.
- Use `ideate --add --topic "..."` (AI enabled) when the user wants richer hooks/takeaways and optional researched context.
- Use `ideate --topics "a,b,c" [--count N]` when the user needs multiple idea candidates quickly.
- Use `--prompt "..."` whenever the user gives extra direction (audience, angle, constraints, tone).
- Use `ideate --list` (optionally `--status ...`) to inspect existing ideas before generating new ones.
- Use `reschedule` to optimize idea-linked post slots; use `realign` to fix schedule drift across future slots.
- Use `--dry-run` first for `realign` and `reschedule` when users ask to preview changes safely.

## Command and flags reference

### Create one idea

```bash
npx vidpipe ideate --add --topic "topic text" [--no-ai] [--prompt "extra guidance"]
```

- `--add`: create one idea directly
- `--topic`: required in add mode
- `--no-ai`: disable AI enrichment
- `--prompt`: optional extra guidance when AI is enabled

### Generate multiple ideas

```bash
npx vidpipe ideate --topics "topic a,topic b,topic c" [--count N] [--prompt "extra guidance"]
```

- `--topics`: comma-separated seeds
- `--count`: ideas per topic
- `--prompt`: optional extra guidance

### List/filter ideas

```bash
npx vidpipe ideate --list [--status draft|ready|recorded|published]
```

- `--list`: show ideas
- `--status`: optional status filter

### View schedule

```bash
npx vidpipe schedule
```

### Fix schedule drift

```bash
npx vidpipe realign [--platform X] [--dry-run]
```

- `--platform`: limit to one platform
- `--dry-run`: preview only

### Optimize idea-linked slots

```bash
npx vidpipe reschedule [--dry-run]
```

- `--dry-run`: preview only

### Open review app

```bash
npx vidpipe review
```

### Check prerequisites

```bash
npx vidpipe doctor
```

## Common workflows

### Create one researched idea from an article topic

```bash
npx vidpipe ideate --add --topic "What this article means for platform engineering teams" --prompt "Reference the article's key finding and propose a contrarian angle."
```

### Create one deterministic draft quickly (no AI)

```bash
npx vidpipe ideate --add --topic "GitOps guardrails for multi-agent repos" --no-ai
```

### Generate a batch and then inspect ready items

```bash
npx vidpipe ideate --topics "gitops,agent safety,platform engineering" --count 2 --prompt "Practical B2B engineering audience."
npx vidpipe ideate --list --status ready
```

### Preview and then apply schedule corrections

```bash
npx vidpipe realign --platform linkedin --dry-run
npx vidpipe realign --platform linkedin
npx vidpipe reschedule --dry-run
npx vidpipe reschedule
```
