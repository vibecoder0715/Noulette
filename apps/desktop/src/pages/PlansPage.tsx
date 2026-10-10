import React from 'react';
import { Layers, ShieldAlert, CheckCircle2, BookmarkCheck } from 'lucide-react';

export interface PlanStage {
  stage: string;
  userScale: string;
  recommendations: {
    type: 'Evidence' | 'Rule of thumb';
    text: string;
  }[];
}

const mockStages: PlanStage[] = [
  {
    stage: 'Stage 1: Launch Ready',
    userScale: 'Now (0 users)',
    recommendations: [
      {
        type: 'Evidence',
        text: 'Database connection pooling configured for serverless scale; PITR backups enabled.'
      },
      {
        type: 'Rule of thumb',
        text: 'Avoid Redis cache clusters until slow query logs prove cache misses under real traffic.'
      }
    ]
  },
  {
    stage: 'Stage 2: Initial Traction',
    userScale: '~100 users',
    recommendations: [
      {
        type: 'Rule of thumb',
        text: 'Keep all background jobs in standard async worker processes on a single instance.'
      },
      {
        type: 'Evidence',
        text: 'Add hard budget alert webhooks for third-party LLM & OpenAI spend at $50/mo and $100/mo.'
      }
    ]
  },
  {
    stage: 'Stage 3: Growing Product',
    userScale: '~1,000 users',
    recommendations: [
      {
        type: 'Evidence',
        text: 'Ensure database composite indexes exist on tenant_id + created_at for all user queries.'
      },
      {
        type: 'Rule of thumb',
        text: 'Separate read-heavy reports from the transactional primary replica.'
      }
    ]
  },
  {
    stage: 'Stage 4: Scale & Reliability',
    userScale: '~10,000 users',
    recommendations: [
      {
        type: 'Rule of thumb',
        text: 'Evaluate multi-region egress and CDN caching for static public assets.'
      },
      {
        type: 'Evidence',
        text: 'Implement circuit breakers around third-party webhook integrations.'
      }
    ]
  }
];

const guardrails = [
  'Do not build microservice meshes before 10k active users',
  'Do not deploy Kafka or distributed message queues when PostgreSQL queues suffice',
  'Do not implement custom multi-tenant sharding before database capacity warrants it',
  'Do not purchase reserved cloud instances until monthly usage patterns stabilize'
];

export function PlansPage() {
  return (
    <div className="page-container" id="plans-page">
      <h1 className="page-title">Plans</h1>

      {/* "Don't build yet" Guardrail List */}
      <div style={{ background: 'var(--status-warning-bg)', border: '1px solid var(--status-warning-border)', borderRadius: 'var(--radius-md)', padding: '18px 22px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--status-warning-text)', marginBottom: '8px' }}>
          <ShieldAlert size={22} color="var(--status-warning-border)" />
          <h4 style={{ fontSize: '19px', fontWeight: 800 }}>"Don't build yet" Guardrails</h4>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.6 }}>
          Avoid premature optimization and unnecessary complexity before your traffic reaches threshold:
        </p>
        <div style={{ display: 'grid', gap: '8px' }}>
          {guardrails.map((g, idx) => (
            <div key={`g-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--status-warning-text)' }}>
              <span>•</span>
              <span>{g}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stage Roadmap Cards */}
      <h3 style={{ fontSize: '19px', fontWeight: 800, marginBottom: '14px' }}>Roadmap Stages</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {mockStages.map((stage, idx) => (
          <div
            key={`stage-${idx}`}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-md)',
              padding: '18px 22px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Layers size={20} color="var(--accent-clay)" />
                <h4 style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)' }}>{stage.stage}</h4>
              </div>
              <span className="status-chip" style={{ fontSize: '11px', fontWeight: 700 }}>{stage.userScale}</span>
            </div>

            <div style={{ display: 'grid', gap: '10px' }}>
              {stage.recommendations.map((rec, rIdx) => {
                const isEvidence = rec.type === 'Evidence';
                const badgeBg = isEvidence ? 'var(--status-safe-bg)' : 'var(--status-ai-bg)';
                const badgeColor = isEvidence ? 'var(--status-safe-text)' : 'var(--status-ai-text)';
                const badgeBorder = isEvidence ? 'var(--status-safe-border)' : 'var(--status-ai-border)';

                return (
                  <div key={`rec-${rIdx}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px' }}>
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: '4px',
                        backgroundColor: badgeBg,
                        color: badgeColor,
                        border: `1px solid ${badgeBorder}`,
                        whiteSpace: 'nowrap',
                        marginTop: '2px'
                      }}
                    >
                      {rec.type}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{rec.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
