import { z } from 'zod';

export const TIERS = ['instant', 'self_serve_with_review', 'review_required', 'partner_gated'];
export const OWNERS = ['agent', 'developer'];
// Strongest to weakest: tested (human did it) > agent_checked (agent endpoint probe) > sourced (official doc URL) > unverified.
export const CONFIDENCE_LEVELS = ['tested', 'agent_checked', 'sourced', 'unverified'];
export const GENERATED_BY = ['human_verified', 'agent'];

const url = z.string().url();
const nonEmpty = z.string().trim().min(1);

export const ProductTierSchema = z.object({
  product: nonEmpty,
  tier: z.enum(TIERS),
  notes: z.string(),
});

export const ComposioManagedAuthSchema = z.object({
  available: z.boolean().nullable(), // null = could not determine
  notes: z.string(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  source_url: url.nullable(),
  supporting_quote: z.string().nullable().optional(),
});

export const AgentAttemptSchema = z.object({
  action: nonEmpty,
  result: nonEmpty,
  evidence: z.string(),
  timestamp: z.string().datetime(),
});

const GuideObject = z.object({
  app: z.object({
    name: nonEmpty,
    website: url,
    category: nonEmpty,
  }),
  tier: z.enum(TIERS),
  // Only when products of one provider differ in access level; top-level tier is the one most agent builders hit.
  product_tiers: z.array(ProductTierSchema).optional(),
  summary: nonEmpty,
  verdict_note: z.string().optional(), // what the endpoint tests found (login wall, gated access, dead URL); agent_checked
  time: z.object({
    // null = unknown; say so in notes rather than guessing.
    setup_minutes_estimate: z.number().nonnegative().nullable(),
    // How well the setup-time and approval-wait figures are backed. Absent on older guides (shown as unverified).
    setup_confidence: z.enum(CONFIDENCE_LEVELS).optional(),
    setup_notes: z.string().optional(),
    approval_wait: z
      .object({
        // Headline shown instead of a numeric range when the wait is a placeholder or unpublished,
        // e.g. "None for basic install · Marketplace: not published". Put any rough range in notes, not min/max.
        label: z.string().optional(),
        confidence: z.enum(CONFIDENCE_LEVELS).optional(),
        min_days: z.number().nonnegative().nullable(),
        max_days: z.number().nonnegative().nullable(),
        notes: z.string(),
      })
      .refine((w) => w.min_days == null || w.max_days == null || w.max_days >= w.min_days, {
        message: 'max_days must be >= min_days',
        path: ['max_days'],
      }),
  }),
  prerequisites: z.array(
    z.object({
      item: nonEmpty,
      required: z.boolean(),
      notes: z.string(),
    }),
  ),
  steps: z
    .array(
      z.object({
        order: z.number().int().positive(),
        title: nonEmpty,
        detail: nonEmpty,
        owner: z.enum(OWNERS),
        url: url.nullable(),
      }),
    )
    .min(1)
    .refine((steps) => new Set(steps.map((s) => s.order)).size === steps.length, {
      message: 'step order values must be unique',
    }),
  scopes: z.array(
    z.object({
      scope: nonEmpty,
      purpose: nonEmpty,
      triggers_review: z.boolean(),
      notes: z.string(),
    }),
  ),
  blockers: z.array(
    z.object({
      issue: nonEmpty,
      how_to_resolve: nonEmpty,
      verified_with: z.string().optional(), // how a 'tested' blocker was observed
      confidence: z.enum(CONFIDENCE_LEVELS).optional(), // 'agent_checked' for blockers found by the endpoint tests
    }),
  ),
  agent_can_do: z.array(nonEmpty),
  developer_must_do: z.array(nonEmpty),
  claims_evidence: z.array(
    z.object({
      claim: nonEmpty,
      confidence: z.enum(CONFIDENCE_LEVELS),
      source_url: url.nullable(),
      // Verbatim excerpt (<300 chars) from source_url's page. Required for agent-written 'sourced' claims,
      // but enforced in agent/generateGuide.js (so a bad quote downgrades the claim instead of failing the guide).
      supporting_quote: z.string().nullable().optional(),
      verified_with: z.string().optional(), // method and date of a human/supervised test; used with confidence 'tested'
    }),
  ),
  notes: z
    .array(z.object({ title: nonEmpty, text: nonEmpty, confidence: z.enum(CONFIDENCE_LEVELS), verified_with: z.string().optional() }))
    .optional(),
  sources: z.array(z.object({ title: nonEmpty, url })),
  composio_managed_auth: ComposioManagedAuthSchema.optional(),
  agent_attempts: z.array(AgentAttemptSchema).optional(),
  meta: z.object({
    generated_by: z.enum(GENERATED_BY),
    generated_at: z.string().datetime(),
    last_checked: z.string().datetime(),
    models_used: z.array(z.string()).optional(),
    verification_method: z.string().optional(), // for human_verified guides: who/what tested it, and when
    skipped_stages: z.array(z.string()).optional(), // research stages that could not finish; their claims are unverified
  }),
});

export const GuideSchema = GuideObject.superRefine((guide, ctx) => {
  guide.claims_evidence.forEach((c, i) => {
    if (c.confidence === 'sourced' && !c.source_url) {
      ctx.addIssue({ code: 'custom', path: ['claims_evidence', i, 'source_url'], message: "'sourced' claims need a source_url" });
    }
    if (c.confidence === 'agent_checked' && !guide.agent_attempts?.length) {
      ctx.addIssue({ code: 'custom', path: ['claims_evidence', i, 'confidence'], message: "'agent_checked' claims need a non-empty agent_attempts record" });
    }
  });
});

/** Throws a ZodError on invalid input; returns the parsed guide otherwise. */
export function validateGuide(data) {
  return GuideSchema.parse(data);
}

/** Non-throwing variant: returns { success, data | error }. */
export function safeValidateGuide(data) {
  return GuideSchema.safeParse(data);
}

export const sampleGithubGuide = {
  app: {
    name: 'GitHub (OAuth App)',
    website: 'https://github.com',
    category: 'developer_tools',
  },
  tier: 'instant',
  summary:
    'OAuth App credentials in about 5 minutes with no review; organizations may still need to approve access to their data.',
  time: {
    setup_minutes_estimate: 5,
    approval_wait: {
      min_days: 0,
      max_days: 0,
      notes:
        'GitHub does not review OAuth Apps. Organization owners can restrict third-party access and must approve your app before it can read org-owned data.',
    },
  },
  prerequisites: [
    { item: 'GitHub account', required: true, notes: 'Register under a personal account or an organization you own.' },
    { item: 'Authorization callback URL', required: true, notes: 'http://localhost URLs are allowed for development.' },
    { item: 'Homepage URL', required: true, notes: 'Any URL describing your app; does not need to be verified.' },
    { item: 'Organization owner approval', required: false, notes: 'Only needed to access private data of organizations with third-party restrictions.' },
  ],
  steps: [
    {
      order: 1,
      title: 'Open the OAuth App registration form',
      detail: 'Go to Settings > Developer settings > OAuth Apps > New OAuth App (or the organization equivalent).',
      owner: 'developer',
      url: 'https://github.com/settings/applications/new',
    },
    {
      order: 2,
      title: 'Fill in app details',
      detail: 'Provide the application name, homepage URL, and authorization callback URL. The agent can suggest values.',
      owner: 'developer',
      url: null,
    },
    {
      order: 3,
      title: 'Generate a client secret',
      detail: 'After registering, copy the Client ID and generate a client secret. The secret is shown only once.',
      owner: 'developer',
      url: null,
    },
    {
      order: 4,
      title: 'Wire credentials into your app',
      detail: 'Store the client ID and secret in environment variables and implement the authorization code flow.',
      owner: 'agent',
      url: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps',
    },
    {
      order: 5,
      title: 'Request org access if needed',
      detail: 'If users belong to organizations that restrict third-party apps, ask an owner to approve your app.',
      owner: 'developer',
      url: 'https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data',
    },
  ],
  scopes: [
    { scope: 'read:user', purpose: "Read the user's profile data.", triggers_review: false, notes: 'Sufficient for basic sign-in.' },
    { scope: 'user:email', purpose: "Read the user's email addresses.", triggers_review: false, notes: 'Needed when the primary email is private.' },
    { scope: 'public_repo', purpose: 'Access public repositories.', triggers_review: false, notes: 'Prefer over repo when private access is unnecessary.' },
    { scope: 'repo', purpose: 'Full access to public and private repositories.', triggers_review: false, notes: 'Very broad; organizations are more likely to deny it. Consider a GitHub App for fine-grained permissions.' },
  ],
  blockers: [
    {
      issue: 'Organization has third-party application restrictions enabled.',
      how_to_resolve: "Ask an organization owner to approve the app under the organization's OAuth application policy.",
    },
    {
      issue: 'Need fine-grained or per-repository permissions.',
      how_to_resolve: 'Use a GitHub App instead of an OAuth App.',
    },
  ],
  agent_can_do: [
    'Suggest app name, homepage and callback URLs',
    'Recommend the minimum scopes for the use case',
    'Generate the authorization code flow implementation',
    'Draft the message asking an org owner for approval',
  ],
  developer_must_do: [
    'Register the OAuth App while signed in to GitHub',
    'Generate and securely store the client secret',
    'Get organization owner approval where required',
  ],
  claims_evidence: [
    {
      claim: 'GitHub OAuth Apps are created instantly without a review process.',
      confidence: 'sourced',
      source_url: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app',
    },
    {
      claim: 'Organizations can restrict third-party OAuth App access and owners approve apps individually.',
      confidence: 'sourced',
      source_url: 'https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data',
    },
    {
      claim: 'Setup takes about 5 minutes.',
      confidence: 'unverified',
      source_url: null,
    },
  ],
  sources: [
    { title: 'Creating an OAuth app', url: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app' },
    { title: 'Scopes for OAuth apps', url: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps' },
    { title: "Managing OAuth access to your organization's data", url: 'https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data' },
  ],
  meta: {
    generated_by: 'agent',
    generated_at: '2026-10-28T00:00:00.000Z',
    last_checked: '2026-10-28T00:00:00.000Z',
  },
};
