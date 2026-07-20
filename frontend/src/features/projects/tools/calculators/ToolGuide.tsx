import { useState } from "react";

/** A single step in an interactive tool guide. */
export interface GuideStep {
  /** Short imperative title, e.g. "Enter control points". */
  title: string;
  /** One or two sentences explaining what to do and why. */
  body: string;
}

export interface ToolGuide {
  /** One-line summary of what the tool does and the direction of computation. */
  summary: string;
  /** Ordered walkthrough steps. */
  steps: GuideStep[];
  /** Optional practical tips shown under the steps. */
  tips?: string[];
}

/**
 * Collapsible, step-by-step "How to use this tool" guide.
 *
 * Rendered above a computation tool so a first-time user who does not know the
 * workflow can expand it, walk the numbered steps, then collapse it out of the
 * way. State is local; nothing is persisted, so it always starts collapsed and
 * never blocks the tool itself.
 */
export function ToolGuidePanel({ guide }: { guide: ToolGuide }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`svt-guide ${open ? "open" : ""}`}>
      <button
        type="button"
        className="svt-guide-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="svt-guide-toggle-main">
          <span className="svt-guide-icon" aria-hidden="true">?</span>
          How to use this tool
        </span>
        <span className="svt-guide-chevron" aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="svt-guide-body">
          <p className="svt-guide-summary">{guide.summary}</p>
          <ol className="svt-guide-steps">
            {guide.steps.map((s, i) => (
              <li key={i}>
                <span className="svt-guide-step-title">{s.title}</span>
                <span className="svt-guide-step-body">{s.body}</span>
              </li>
            ))}
          </ol>
          {guide.tips && guide.tips.length > 0 && (
            <div className="svt-guide-tips">
              <span className="svt-guide-tips-title">Tips</span>
              <ul>
                {guide.tips.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
