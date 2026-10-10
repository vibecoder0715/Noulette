import React, { useState } from 'react';
import { ShieldCheck, CheckCircle2, AlertOctagon, RotateCw } from 'lucide-react';
import { DiffViewer } from '../components/DiffViewer.js';
import { AcceptRiskModal } from '../components/AcceptRiskModal.js';
import { tauriInvoke } from '../util/ipc.js';

export interface DecisionCardData {
  decisionId: string;
  findingId: string;
  title: string;
  category: string;
  file: string;
  line: number;
  isBlocking: boolean;
  whatWasWrong: string;
  patch: string;
  proofList: string[];
  youMustDo: string[];
  status: 'pending' | 'approved' | 'risk-accepted' | 'rejected';
}

const mockDecision: DecisionCardData = {
  decisionId: 'dec_01J00000000000000000000001',
  findingId: 'fnd_01J00000000000000000000001',
  title: 'Arbitrary code execution via eval(userInput) in search handler',
  category: 'Code Mistake (High)',
  file: 'src/search.js',
  line: 42,
  isBlocking: true,
  whatWasWrong: 'The endpoint passed unvalidated query input directly into the eval() JavaScript interpreter, allowing remote attackers to run arbitrary code.',
  patch: `--- a/src/search.js
+++ b/src/search.js
@@ -40,4 +40,4 @@
-const queryResult = eval(userInput);
+const queryResult = JSON.parse(userInput);
`,
  proofList: [
    'Finding fingerprint eradicated from working copy',
    'Zero new security findings introduced across codebase',
    'All existing unit & integration test suites pass',
    'Generated regression test passes on fixed candidate'
  ],
  youMustDo: [
    'Verify no other endpoints accept raw strings intended for JSON parsing'
  ],
  status: 'pending'
};

export function DecisionsPage() {
  const [decision, setDecision] = useState<DecisionCardData>(mockDecision);
  const [isRiskModalOpen, setIsRiskModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleApprove = async () => {
    try {
      await tauriInvoke('sign_decision', {
        project_path: 'my-shop-app',
        decision_id: decision.decisionId
      });
      setDecision(prev => ({ ...prev, status: 'approved' }));
      setStatusMessage('Fix approved and cryptographically signed. Ready to apply to main tree.');
    } catch (err: any) {
      alert(`Approval failed: ${err.message || err}`);
    }
  };

  const handleAcceptRisk = async (reason: string, owner: string, days: number) => {
    if (decision.isBlocking) {
      alert('Cannot accept risk: this finding is a policy hard stop (blocking: true). A verified fix is required.');
      return;
    }
    try {
      await tauriInvoke('record_decision', {
        project_path: 'my-shop-app',
        decision_id: decision.decisionId,
        action: 'accept-risk',
        reason,
        owner,
        days
      });
      setDecision(prev => ({ ...prev, status: 'risk-accepted' }));
      setStatusMessage(`Risk exemption signed for ${days} days by ${owner}.`);
    } catch (err: any) {
      alert(`Risk acceptance failed: ${err.message || err}`);
    }
  };

  const handleReject = async () => {
    try {
      await tauriInvoke('record_decision', {
        project_path: 'my-shop-app',
        decision_id: decision.decisionId,
        action: 'reject'
      });
      setDecision(prev => ({ ...prev, status: 'rejected' }));
      setStatusMessage('Attempt rejected and discarded. The finding remains open.');
    } catch (err: any) {
      alert(`Reject failed: ${err.message || err}`);
    }
  };

  return (
    <div className="page-container" id="decisions-page">
      <h1 className="page-title">Decisions</h1>

      {statusMessage && (
        <div style={{ padding: '12px 18px', background: 'var(--status-safe-bg)', color: 'var(--status-safe-text)', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '13px', border: '1px solid var(--status-safe-border)' }}>
          {statusMessage}
        </div>
      )}

      {/* Decision Card */}
      <div
        className="card"
        id="decision-card"
        style={{ padding: '24px', maxWidth: '840px' }}
      >
        {/* Card Header & Metadata */}
        <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span className="status-chip critical">
                Stops release
              </span>
              <span className="status-chip warning">{decision.category}</span>
            </div>
          </div>

          <h3 className="card-title" style={{ fontSize: '19px', fontWeight: 800, marginBottom: '8px' }}>
            {decision.title}
          </h3>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Location: <code>{decision.file}:{decision.line}</code>
          </div>
        </div>

        {/* Section 1: What was wrong */}
        <div style={{ marginBottom: '18px' }}>
          <h4 className="section-title" style={{ fontSize: '19px', fontWeight: 800, marginBottom: '6px' }}>
            1. What was wrong
          </h4>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {decision.whatWasWrong}
          </p>
        </div>

        {/* Section 2: What changed (Safe Diff Viewer) */}
        <div style={{ marginBottom: '18px' }}>
          <h4 className="section-title" style={{ fontSize: '19px', fontWeight: 800, marginBottom: '6px' }}>
            2. What changed (verified patch)
          </h4>
          <DiffViewer patch={decision.patch} />
        </div>

        {/* Section 3: Proof Checklist */}
        <div style={{ marginBottom: '18px' }}>
          <h4 className="section-title" style={{ fontSize: '19px', fontWeight: 800, marginBottom: '8px' }}>
            3. Referee verification proof
          </h4>
          <div style={{ display: 'grid', gap: '8px' }}>
            {decision.proofList.map((item, i) => (
              <div key={`proof-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--status-safe-text)' }}>
                <CheckCircle2 size={18} color="var(--status-safe-border)" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4: What you must do */}
        {decision.youMustDo.length > 0 && (
          <div style={{ marginBottom: '20px', background: 'var(--bg-app)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)', padding: '14px' }}>
            <h4 className="section-title" style={{ fontSize: '19px', fontWeight: 800, marginBottom: '6px' }}>
              4. What you must do yourself
            </h4>
            {decision.youMustDo.map((item, i) => (
              <p key={`must-do-${i}`} style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                • {item}
              </p>
            ))}
          </div>
        )}

        {/* Actions Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '20px' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              className="btn-clay"
              id="approve-decision-btn"
              onClick={handleApprove}
              disabled={decision.status !== 'pending'}
            >
              <ShieldCheck size={24} />
              <span>{decision.status === 'approved' ? 'Signed & Approved' : 'Approve & Sign'}</span>
            </button>

            <button
              className="btn-outlined"
              id="accept-risk-btn"
              onClick={() => setIsRiskModalOpen(true)}
              disabled={decision.status !== 'pending'}
            >
              <span>Accept risk...</span>
            </button>
          </div>

          <button
            className="btn-text"
            id="reject-decision-btn"
            style={{ color: 'var(--status-critical-text)' }}
            onClick={handleReject}
            disabled={decision.status !== 'pending'}
          >
            Reject attempt
          </button>
        </div>
      </div>

      <AcceptRiskModal
        isOpen={isRiskModalOpen}
        onClose={() => setIsRiskModalOpen(false)}
        onSubmit={handleAcceptRisk}
        findingTitle={decision.title}
      />
    </div>
  );
}
