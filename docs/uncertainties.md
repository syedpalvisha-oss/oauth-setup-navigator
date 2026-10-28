# Uncertainties in the draft guides

Drafted 2026-10-28 from official docs. Every item below is an `unverified` claim in the matching file in `server/data/guides/`. Replace with `tested` once verified by hand. The `tested` and `human_verified` markers are only for the guide author's own setup runs.

## All guides
- Setup-minute estimates (GitHub 5, Slack 15, Gmail 20, LinkedIn 15) are guesses, not measurements.

## GitHub (`github.json`)
- The org third-party-restriction behavior was not re-fetched from the docs in this pass.
- Whether `http://localhost` callback URLs are accepted is not stated on the registration page.
- "No scope triggers a GitHub review; breadth only affects org owner approval" is an assumption.

## Slack (`slack.json`)
- Slack publishes no Marketplace review timeline. `max_days: 14` is a placeholder, not a documented figure. The "1-2 weeks" figure is unsourced.
- Non-Marketplace apps may have stricter API rate limits on some methods. The docs fetched did not confirm this.
- The example scopes (`chat:write`, `channels:read`, `users:read`) and the claim that none trigger scope-specific review are unchecked.

## Google / Gmail (`google-gmail.json`)
- The 14-60 day approval range is an estimate. Google only says restricted-scope verification "can potentially take several weeks".
- No timeline was found for sensitive-only verification or for the CASA security assessment. No CASA cost was found.
- Privacy policy and authorized-domain requirements for verification were not confirmed. The fetched page was truncated.
- Assumed that sensitive-only scopes such as `gmail.send` do not require CASA.
- Testing-mode / Internal claim (added later): the docs separately state (a) the restricted-scope exemptions for development/testing/staging projects and internal Workspace use, and (b) Testing status limits of 100 test users, an unverified warning and 7-day token expiry. They do not explicitly say that Testing status equals the "development/testing" exemption. The audience page also does not say whether Internal apps need verification. The two halves are `sourced`; the combined statement is `unverified`.

## LinkedIn (`linkedin.json`)
- The app-creation docs URL returned 404. Page, privacy-policy and logo requirements at creation are unverified.
- Page-verification details come from a search result for LinkedIn's help page, not a full fetch.
- The v1 sign-in deprecation date (2023-08-01) comes from a search snippet.
- Partner-program approval timelines are unknown.
- Community Management API access requirements and process were not verified against docs.
- "Product enablement is immediate" is unverified.
