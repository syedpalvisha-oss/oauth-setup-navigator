export const TIERS = {
  instant: { label: 'Instant', cls: 'c-green' },
  self_serve_with_review: { label: 'Self-serve + review', cls: 'c-amber' },
  review_required: { label: 'Review required', cls: 'c-orange' },
  partner_gated: { label: 'Partner gated', cls: 'c-red' },
};

export const CONFIDENCE = {
  tested: { label: 'tested', cls: 'c-purple', blurb: 'A human did this setup end to end.' },
  agent_checked: { label: 'agent_checked', cls: 'c-blue', blurb: 'The agent probed a live endpoint and saw it.' },
  sourced: { label: 'sourced', cls: 'c-green', blurb: 'Official docs state it, with a verbatim quote.' },
  unverified: { label: 'unverified', cls: 'c-gray', blurb: 'No official source or probe backs it. Treat it as a lead.' },
};

export function TierBadge({ tier }) {
  const t = TIERS[tier] ?? { label: tier, cls: 'c-gray' };
  return <span className={`pill ${t.cls}`}>{t.label}</span>;
}

export function ConfidencePill({ level }) {
  const c = CONFIDENCE[level] ?? { label: level, cls: 'c-gray' };
  return <span className={`pill ${c.cls}`}>{c.label}</span>;
}

export function VerifiedTag({ generatedBy }) {
  return generatedBy === 'human_verified' ? <span className="tag human">✓ Human verified</span> : <span className="tag">Agent generated</span>;
}

export function Legend() {
  return (
    <div className="card legend" role="group" aria-label="Confidence levels">
      {Object.entries(CONFIDENCE).map(([k, c]) => (
        <div key={k}>
          <span className={`pill ${c.cls}`}>{c.label}</span>
          <span className="sub">{c.blurb}</span>
        </div>
      ))}
    </div>
  );
}
