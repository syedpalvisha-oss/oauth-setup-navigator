# Learnings

## Quote verification vs. prompt size
To fit free-tier token limits, I cut page text sent to the model from 1,800 to 900 chars. Side effect: the quote checker verified against that shortened text, so sourced claims dropped from 3 to 0. The claims weren't wrong; the checker just couldn't see enough of the page. Fix: cache fuller page text (~4,000 chars) for verification, and send only trimmed text to the model. Lesson: evidence checks must run on the full source, not on whatever fit in the prompt.

## Zoom results after decoupling verification from prompt size
After caching ~4,000 chars per page for verification (stages 1-5 still see 900 chars; stage 7 sees up to 1,500 per cited URL), the regenerated Zoom guide had 2 sourced / 0 agent_checked / 6 unverified claims in 67.2s. The original guide had 3 sourced / 1 agent_checked / 3 unverified, so it was kept. (Counts include the Composio entry.)

| Zoom guide | sourced | agent_checked | unverified |
|---|---|---|---|
| Original (kept) | 3 | 1 | 3 |
| Regenerated, 900-char prompts, no decoupling | 0 | 1 | 7 |
| Regenerated, decoupled verification | 2 | 0 | 6 |

Decoupling recovered most of the sourced claims (0 to 2) but not all of them. The remaining downgrades are quotes the model wrote that do not appear on the cached page, so the sourced count is now limited by what the model copies rather than by what the checker can see. Moving stage 4 to the 20b model only shifted a 60s token-budget wait from stage 7 to stage 4.

## GitHub OAuth App: what the draft said vs. what a real setup showed
A supervised browser agent (Claude in Chrome) registered a real GitHub OAuth App on 2026-10-29 and then deleted it. The agent-written draft was mostly right about the flow but wrong or silent on details that only show up in the form itself:

| Topic | Draft said | The test showed |
|---|---|---|
| Callback URL | One "authorization callback URL" field (the prerequisite and the registration claim both used the singular) | A "Redirect URIs" list of up to 10 entries, with an optional "Allow wildcard matching" checkbox. At least one is required |
| localhost | "Not stated on the registration page" (marked unverified) | Accepted: a localhost URL with a port, and one with a port and a path, both went through with no warning |
| Setup time | About 5 minutes (unverified estimate) | Registration took about 30 seconds; about 1 minute including reading the form |
| Approval wait | None, but unverified ("the docs describe no review") | None: the app was live the moment it was registered. The only related option is an optional Marketplace listing button |
| Client secret | Step 3 implied it comes with registration | Nothing is generated at registration; the settings page has a "Generate a new client secret" button |
| Scopes | Listed scopes as part of setup | No scope field at registration; scopes are requested at login by the app |
| Org restrictions | "Organizations can restrict third-party apps" (unverified) | Observed a test org whose policy reads "Access restricted: only approved apps can access org data". A member actually being blocked was not exercised |

Confirmed unchanged: "Expire user access tokens" is on by default. Lessons: the registration form is the source of truth, so UI wording ("callback URL" vs "Redirect URIs") drifts from the docs; and "not stated in the docs" claims are cheap to settle with a minute of hands-on testing, so a short supervised run beats a long list of unverified claims.

## Fresh agent run vs. the tested GitHub guide (eval, 2026-10-29)
A fresh `--refresh` run on "GitHub" (full table in `eval-results.md`, output in `docs/eval/github-agent-run.json`) matched the tested guide on tier, portal path, Composio and device flow, but missed or got wrong the details that matter most to a developer:

- **Client secret:** the agent said the secret is generated at creation. The test showed nothing is created at registration; you click "Generate a new client secret". Confident wrong claims like this need a hands-on check.
- **Org approval was missed as a blocker:** `blockers` came back empty. The agent attached org approval to "sensitive scopes" instead, but the restriction applies to any app in an org with "Access restricted". Org-level policies need their own search, separate from the scope-review search.
- **Scopes are not a registration step.** It listed "Configure scopes" as step 5 and set `triggers_review: true` on `repo` and `user`. The test found no scope field at registration and no GitHub review, only org owner approval. "Sensitive scopes trigger review" looks like a pattern copied from other providers (Google, Slack).
- **OAuth App vs GitHub App was never mentioned,** so the "use a GitHub App for fine-grained permissions" blocker was lost. When a provider has two app types, the agent should compare them explicitly.
- **Redirect URIs:** the agent wrote a single "callback URL" with an HTTPS-except-localhost rule. The form has a list of up to 10 URIs with optional wildcards. Docs wording lags the UI.
- **Setup time and approval wait stayed `unverified`/null** while the summary still said "approved instantly unless they request sensitive scopes", which is a review step that doesn't exist. Summaries should not state more than the field confidence supports.
- **Evidence coverage was thin:** only 2 `claims_evidence` entries, none covering the wrong claims. The model can write steps with no evidence row, so wrong claims escape the confidence labels. Consider requiring an evidence entry per step-level factual claim, or marking uncovered steps as unverified.
