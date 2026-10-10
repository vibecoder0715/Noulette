import React from 'react';
import { renderSanitizedText } from '../util/sanitize-text.js';

export interface DiffViewerProps {
  patch: string;
}

export function DiffViewer({ patch }: DiffViewerProps) {
  if (!patch || patch.trim().length === 0) {
    return <div className="diff-viewer" style={{ padding: '12px', color: 'var(--text-secondary)' }}>No changes to display.</div>;
  }

  const lines = patch.split('\n');

  return (
    <div className="diff-viewer" role="region" aria-label="Unified Diff">
      {lines.map((line, idx) => {
        let lineClass = 'diff-line';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          lineClass = 'diff-line add';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          lineClass = 'diff-line del';
        } else if (line.startsWith('@@')) {
          lineClass = 'diff-line hunk';
        }

        return (
          <div key={`line-${idx}`} className={lineClass}>
            {renderSanitizedText(line)}
          </div>
        );
      })}
    </div>
  );
}
