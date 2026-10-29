# Eval: fresh agent run vs. the tested GitHub guide

- **Agent run:** `docs/eval/github-agent-run.json` (log: `docs/eval/github-agent-run.log`). Command: `npm run generate:guide -- --refresh "GitHub"` on 2026-10-29. It took 14.7s, with live Tavily and Groq calls and no cached model output.
- **Reference:** `server/data/guides/github.json`, the guide a supervised browser agent tested against a real OAuth App registration on 2026-10-29. `github.json` was not modified.
- **Verdicts:** Right means it matches the tested guide. Partial means the direction is right but it is hedged or incomplete. Wrong means it contradicts what the test observed. Missed means the topic is absent.

| Dimension | Tested guide says | Agent said | Verdict |
|---|---|---|---|
| Tier | `instant` | `instant` (plus a `product_tiers` entry for OAuth) | Right |
| Setup time | About 1 minute (30s registration), `tested` | `setup_minutes_estimate: null`, `unverified`, "exact time varies by developer" | Missed. It gave no number. |
| Approval wait | None: the app is live on registration. `tested` | Label "None for basic install · Marketplace: not published", `unverified`, null min and max days. Summary says "most apps are approved instantly unless they request sensitive scopes" | Partial. The label says None, but it is unverified and the summary implies a review step that doesn't exist. |
| Redirect URI details | A list of up to 10 URIs, an optional "Allow wildcard matching" checkbox, at least one required, and `http://localhost` URLs accepted with a port or a port and path | Singular "callback URL (must use HTTPS except for localhost)". "Configure redirect URIs correctly" appears only in `developer_must_do`. | Partial. The localhost exception is consistent with the test, but the HTTPS rule is unsourced. It missed the list, the 10-entry cap and the wildcard option. It also used the stale "callback URL" wording. |
| Client secret behavior | No secret is created at registration. You click "Generate a new client secret" on the settings page. | "After creation, copy the generated client ID and client secret" | Wrong. It implies the secret is created automatically. |
| Org-restriction blocker | Blocker (`tested`): in an org with "Access restricted", an owner must approve the app before members can grant org data access. Resolution: Settings → Third-party application access. | `blockers: []`. Org approval appears only as a note on the `repo` and `user` scopes. | Missed as a blocker. It also wrongly ties org approval to sensitive scopes. The restriction applies to any app in a restricted org. |
| OAuth App vs GitHub App | Tested note on permissions, webhooks, install flow and account choice. Also a blocker: "need fine-grained or per-repository permissions → use a GitHub App". | Not mentioned anywhere | Missed |
| Scopes at registration | No scope field at registration. The app requests scopes at login. | Step 5: "Configure scopes: select the required scopes for your app" | Wrong. It presents scope selection as a setup step. |
| Scopes trigger review | `unverified`, but the tested guide's position is that no scope triggers a GitHub review, only org owner approval | `repo` and `user` have `triggers_review: true`, described as sensitive scopes that may trigger review | Wrong. This is likely invented, and it is unsourced. |
| Expiring user tokens | "Expire user access tokens" is on by default (`tested`) | Not mentioned | Missed |
| Device flow / grant types | Device Flow is optional and off by default | Sourced claim: supports the authorization code grant and the Device Authorization Grant | Right |
| Composio managed auth | Available, sourced | Available, sourced | Right |
| Developer-portal path | Settings > Developer settings > OAuth Apps > New OAuth App | Same path (`/settings/developers`) | Right |
| Endpoint probes | n/a | Authorize endpoint reached (a login redirect, reported as "HTTP 200"). Both `.well-known` discovery URLs return 404. | Right (supporting evidence) |
| `agent_can_do` | Four items | Empty list | Missed |
| Confidence labeling | Mostly `tested`, with the unsourced claims marked | Only 2 claims in `claims_evidence`, 1 sourced and 1 unverified. The substantive claims have no evidence entries. | Weak. Wrong claims such as the client secret and scope steps carry no evidence rating, so a reader can't tell they are unchecked. |

## Tally

- **Right (5):** tier, device flow and grant types, Composio, developer-portal path, endpoint probes.
- **Partial (2):** approval wait, redirect URI details.
- **Wrong (3):** client secret behavior, scopes as a registration step, scopes triggering review.
- **Missed (6):** setup time, org-restriction blocker, OAuth App vs GitHub App, expiring tokens, `agent_can_do`, plus the confidence gap noted above.

## Takeaways

The agent gets the shape of the flow (tier, portal path, the sign-in step) and avoids some errors by leaving fields `unverified`. It gets the form details wrong, and it overstates scopes and review. It misses the blocker that matters most, org owner approval, and it never raises the choice of a GitHub App. See `docs/learnings.md`.
