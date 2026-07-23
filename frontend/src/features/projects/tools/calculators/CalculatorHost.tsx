import "../../../../styles/survey-tools.css";
import type { CalcToolId } from "../toolRegistry.ts";
import { LevellingTool } from "./LevellingTool.tsx";
import { TraverseTool } from "./TraverseTool.tsx";
import { AreaTool } from "./AreaTool.tsx";
import {
  PolarForwardTool,
  JoinInverseTool,
  IntersectionTool,
  ResectionTool,
  AngleConverterTool,
} from "./FormTools.tsx";
import {
  StakeOutTool,
  HorizontalCurveTool,
  VerticalCurveTool,
} from "./AlignmentTools.tsx";

interface CalculatorHostProps {
  calc: CalcToolId;
  onClose: () => void;
}

/** Full-screen survey computation tool host (replaces the cramped modal). */
export function CalculatorHost({ calc, onClose }: CalculatorHostProps) {
  return (
    <div className="project-workspace svt-host">
      <header className="svt-host-bar">
        <button className="btn btn-outline btn-sm" onClick={onClose} title="Back to tools">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back to tools
        </button>
      </header>
      <div className="svt-host-body" style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        {calc === "levelling" && <LevellingTool />}
        {calc === "traverse-adjustment" && <TraverseTool />}
        {calc === "area-volume" && <AreaTool />}
        {calc === "polar-forward" && <PolarForwardTool />}
        {calc === "join-inverse" && <JoinInverseTool />}
        {calc === "intersection" && <IntersectionTool />}
        {calc === "resection" && <ResectionTool />}
        {calc === "angle-converter" && <AngleConverterTool />}
        {calc === "stakeout" && <StakeOutTool />}
        {calc === "horizontal-curve" && <HorizontalCurveTool />}
        {calc === "vertical-curve" && <VerticalCurveTool />}
      </div>
    </div>
  );
}
