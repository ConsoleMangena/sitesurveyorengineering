import { getCadDrawing } from "./cadDrawings.ts";

/**
 * Real, data-backed metrics for a project workspace dashboard.
 *
 * These replace the previously fabricated KPI values (which were derived from
 * string-matching the activity log). Where a metric has no real data source
 * yet, it is reported as 0 rather than invented.
 */
export interface ProjectMetrics {
  /** Survey points actually present in the project's CAD drawing. */
  points: number;
  /** Linework entities (lines, polylines, boundaries) in the drawing. */
  linework: number;
  /** TIN surfaces built in the drawing. */
  surfaces: number;
  /** Points flagged with a "QA"/"CHECK" code awaiting review. */
  qaFlags: number;
}

interface CadModelShape {
  points?: { code?: string }[];
  linework?: unknown[];
  surfaces?: unknown[];
}

const QA_CODES = ["QA", "CHECK", "FLAG", "REVIEW"];

export async function getProjectMetrics(projectId: string): Promise<ProjectMetrics> {
  const empty: ProjectMetrics = { points: 0, linework: 0, surfaces: 0, qaFlags: 0 };

  try {
    const record = await getCadDrawing(projectId);
    const model = (record?.model ?? null) as CadModelShape | null;
    if (!model) return empty;

    const points = Array.isArray(model.points) ? model.points : [];
    const qaFlags = points.filter((p) => {
      const code = (p.code ?? "").toUpperCase();
      return QA_CODES.some((q) => code.includes(q));
    }).length;

    return {
      points: points.length,
      linework: Array.isArray(model.linework) ? model.linework.length : 0,
      surfaces: Array.isArray(model.surfaces) ? model.surfaces.length : 0,
      qaFlags,
    };
  } catch {
    return empty;
  }
}
