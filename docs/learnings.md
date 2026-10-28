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
