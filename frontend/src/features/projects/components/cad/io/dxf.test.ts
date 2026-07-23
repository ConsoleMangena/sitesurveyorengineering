import { describe, it, expect } from "vitest";
import { modelToDxf } from "./dxf.ts";
import { emptyModel, type CadModelState } from "../cadModel.ts";

function baseModel(): CadModelState {
  return emptyModel();
}

describe("modelToDxf", () => {
  it("produces a well-formed R2000 DXF skeleton", () => {
    const dxf = modelToDxf(baseModel());
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("$ACADVER");
    // AC1015 (AutoCAD 2000) — lowest version valid for LWPOLYLINE / 3DFACE.
    expect(dxf).toContain("AC1015");
    expect(dxf).toContain("TABLES");
    expect(dxf).toContain("ENTITIES");
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
  });

  it("emits a LAYER table entry per layer", () => {
    const model = baseModel();
    const dxf = modelToDxf(model);
    // One LAYER table header + one entry per default layer.
    const layerEntries = dxf.split("\n").filter((l) => l === "LAYER").length;
    // First "LAYER" is the table name (group 2), the rest are entries.
    expect(layerEntries).toBeGreaterThanOrEqual(model.layers.length);
  });

  it("maps Easting->X (code 10) and Northing->Y (code 20) for points", () => {
    const model = baseModel();
    model.points.push({ id: "p", pointNo: "1", n: 1000, e: 5000, z: 12, code: "", layerId: "TOPO" });
    const dxf = modelToDxf(model);
    expect(dxf).toContain("POINT");
    // X group (10) carries Easting, Y group (20) carries Northing.
    expect(dxf).toMatch(/10\n5000\n/);
    expect(dxf).toMatch(/20\n1000\n/);
    expect(dxf).toMatch(/30\n12\n/);
  });

  it("emits LINE for a 2-vertex line", () => {
    const model = baseModel();
    model.linework.push({
      id: "l", kind: "line", closed: false, layerId: "TOPO",
      vertices: [{ n: 0, e: 0 }, { n: 10, e: 10 }],
    });
    const dxf = modelToDxf(model);
    expect(dxf).toContain("LINE");
    expect(dxf).not.toContain("LWPOLYLINE");
  });

  it("emits a closed LWPOLYLINE for a boundary", () => {
    const model = baseModel();
    model.linework.push({
      id: "b", kind: "boundary", closed: true, layerId: "BOUNDARY",
      vertices: [{ n: 0, e: 0 }, { n: 0, e: 10 }, { n: 10, e: 10 }],
    });
    const dxf = modelToDxf(model);
    expect(dxf).toContain("LWPOLYLINE");
    // Closed flag group 70 = 1.
    expect(dxf).toMatch(/70\n1\n/);
  });
});
