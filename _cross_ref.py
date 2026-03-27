#!/usr/bin/env python3
"""Cross-reference Zernio scheduled posts with GitHub issues in content-management."""
import subprocess, json, re, sys
from datetime import datetime, timezone, timedelta

CDT = timezone(timedelta(hours=-5))

# ── Step 1: GraphQL fetch all issues + comments ──────────────────────
QUERY = """
query($cursor: String) {
  repository(owner: "htekdev", name: "content-management") {
    issues(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        state
        labels(first: 20) { nodes { name } }
        comments(first: 100) {
          nodes { body }
        }
      }
    }
  }
}
"""

print("=== Step 1: Fetching all issues + comments from content-management ===")
all_issues = []
cursor = None
page = 0

while True:
    page += 1
    cmd = ["gh", "api", "graphql", "-f", f"query={QUERY}"]
    if cursor:
        cmd += ["-f", f"cursor={cursor}"]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        print(f"ERROR: {result.stderr}")
        sys.exit(1)
    data = json.loads(result.stdout)
    issues_data = data["data"]["repository"]["issues"]
    all_issues.extend(issues_data["nodes"])
    print(f"  Page {page}: fetched {len(issues_data['nodes'])} issues (total: {len(all_issues)})")
    if not issues_data["pageInfo"]["hasNextPage"]:
        break
    cursor = issues_data["pageInfo"]["endCursor"]

# ── Step 2: Extract latePostId → issue mapping ──────────────────────
print(f"\n=== Step 2: Extracting publish records from {len(all_issues)} issues ===")
post_to_issue = {}
for issue in all_issues:
    for comment in issue["comments"]["nodes"]:
        body = comment["body"]
        json_blocks = re.findall(r"```json\s*(\{.*?\})\s*```", body, re.DOTALL)
        for block in json_blocks:
            try:
                parsed = json.loads(block)
                if parsed.get("type") == "publish-record":
                    rec = parsed["record"]
                    late_id = rec.get("latePostId")
                    if late_id:
                        post_to_issue[late_id] = {
                            "issueNumber": issue["number"],
                            "issueTitle": issue["title"],
                            "platform": rec.get("platform", "?"),
                            "clipType": rec.get("clipType", "?"),
                            "state": issue["state"],
                        }
            except json.JSONDecodeError:
                pass

print(f"  Found {len(post_to_issue)} publish records with Late post IDs")

# ── Step 3: Get today's scheduled posts from Zernio ──────────────────
print("\n=== Step 3: Fetching today's scheduled posts from Zernio ===")
today = datetime.now(CDT).strftime("%Y-%m-%d")
tomorrow = (datetime.now(CDT) + timedelta(days=1)).strftime("%Y-%m-%d")

ZERNIO = r"C:\Users\floreshector\AppData\Roaming\npm\zernio.cmd"

cmd = [ZERNIO, "posts:list", "--status", "scheduled", "--from", today, "--to", tomorrow, "--limit", "100"]
result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
if result.returncode != 0:
    print(f"ERROR: {result.stderr}")
    sys.exit(1)

zernio_data = json.loads(result.stdout)
posts = zernio_data.get("posts", [])
total = zernio_data.get("pagination", {}).get("total", len(posts))
print(f"  Found {total} scheduled posts today ({len(posts)} fetched)")

# ── Step 4: Cross-reference ──────────────────────────────────────────
print(f"\n=== Step 4: Cross-referencing {len(posts)} Zernio posts with {len(post_to_issue)} publish records ===\n")

matched = []
unmatched = []

for p in posts:
    post_id = p.get("_id", "")
    content = (p.get("content", "") or p.get("title", ""))[:60].replace("\n", " ")
    for plat in p.get("platforms", []):
        sched = plat.get("scheduledFor", "")
        pname = plat.get("platform", "?")
        acct = plat.get("accountId", {})
        display = acct.get("displayName", "") or acct.get("username", "")
        if sched:
            dt = datetime.fromisoformat(sched.replace("Z", "+00:00")).astimezone(CDT)
            tstr = dt.strftime("%I:%M %p")
        else:
            tstr = "??"

        if post_id in post_to_issue:
            info = post_to_issue[post_id]
            matched.append((sched, tstr, pname, display, content, info))
        else:
            unmatched.append((sched, tstr, pname, display, content, post_id))

matched.sort()
unmatched.sort()

print(f"✅ MATCHED (linked to a GitHub issue): {len(matched)}")
print("-" * 120)
for _, t, pl, disp, txt, info in matched:
    print(f"  {t}  {pl:12s}  #{info['issueNumber']:<4d} [{info['clipType']:12s}] {info['issueTitle'][:50]}")
    
print(f"\n❌ UNMATCHED (no GitHub issue found): {len(unmatched)}")
print("-" * 120)
for _, t, pl, disp, txt, pid in unmatched:
    print(f"  {t}  {pl:12s}  @{disp:15s} {txt}...")

print(f"\n=== Summary ===")
print(f"  Total posts today:    {len(matched) + len(unmatched)}")
print(f"  Linked to issue:      {len(matched)}")
print(f"  No issue (orphaned):  {len(unmatched)}")
pct = (len(matched) / (len(matched) + len(unmatched)) * 100) if (matched or unmatched) else 0
print(f"  Coverage:             {pct:.1f}%")
