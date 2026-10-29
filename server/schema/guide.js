import { z } from 'zod';

export const TIERS = ['instant', 'self_serve_with_review', 'review_required', 'partner_gated'];
export const OWNERS = ['agent', 'developer'];
// Strongest to weakest: tested (human did it) > agent_checked (agent endpoint probe) > sourced (official doc URL) > unverified.
export const CONFIDENCE_LEVELS = ['tested', 'agent_checked', 'sourced', 'unverified'];
export const GENERATED_BY = ['human_verified', 'agent'];

const url = z.string().url();
const nonEmpty = z.string().trim().min(1);

// Every actionable item (prerequisite, step, scope, blocker) carries its own confidence, so a wrong claim is never unlabeled.
// A missing level means nobody backed the item, so it defaults to 'unverified'. 'sourced' items also give source_url and a
// verbatim supporting_quote (checked in agent/generateGuide.js, where a bad one is downgraded instead of failing the guide).
const itemEvidence = {
  confidence: z.enum(CONFIDENCE_LEVELS).default('unverified'),
  source_url: url.nullable().optional(),
  supporting_quote: z.string().nullable().optional(),
};

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
      ...itemEvidence,
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
        ...itemEvidence,
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
      ...itemEvidence,
    }),
  ),
  blockers: z.array(
    z.object({
      issue: nonEmpty,
      how_to_resolve: nonEmpty,
      verified_with: z.string().optional(), // how a 'tested' blocker was observed
      ...itemEvidence, // 'agent_checked' for blockers found by the endpoint tests
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

/** Returns { success, data | error }. */
export function safeValidateGuide(data) {
  return GuideSchema.safeParse(data);
}
