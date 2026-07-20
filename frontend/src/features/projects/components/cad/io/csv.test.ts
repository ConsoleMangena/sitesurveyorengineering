import { describe, it, expect } from "vitest";
import { parsePointsCsv, pointsToCsv } from "./csv.ts";
import type { SurveyPoint } from "../cadModel.ts";

describe("parsePointsCsv", () => {
  it("parses P,Y(E),X(N),Z,Code rows", () => {
    // Columns after PointNo are Y(Easting), X(Northing), Z, Code.
    const text = "1001,5000.25,1000.5,12.3,CP\n1002,5010,1010,,TREE";
    const res = parsePointsCsv(text);
    expect(res.points).toHaveLength(2);
    expect(res.points[0]).toEqual({
      pointNo: "1001",
      n: 1000.5,
      e: 5000.25,
      z: 12.3,
      code: "CP",
    });
    expect(res.points[1].z).toBeNull();
  });

  it("auto-detects and skips a header row", () => {
    const text = "PointNo,Y,X,Z,Code\n1,200,100,5,A";
    const res = parsePointsCsv(text);
    expect(res.points).toHaveLength(1);
    expect(res.points[0].pointNo).toBe("1");
    expect(res.points[0].e).toBe(200); // Y column -> Easting
    expect(res.points[0].n).toBe(100); // X column -> Northing
  });

  it("supports tab and semicolon delimiters", () => {
    // Y(Easting)=200 in the second column.
    const tab = parsePointsCsv("1\t200\t100\t\tA");
    expect(tab.points[0].e).toBe(200);
    const semi = parsePointsCsv("1;200;100;;A");
    expect(semi.points[0].e).toBe(200);
  });

  it("records errors and skips invalid X/Y", () => {
    const res = parsePointsCsv("1,abc,def,0,X");
    expect(res.points).toHaveLength(0);
    expect(res.skipped).toBe(1);
    expect(res.errors.length).toBe(1);
  });

  it("skips short rows", () => {
    const res = parsePointsCsv("1,100");
    expect(res.points).toHaveLength(0);
    expect(res.skipped).toBe(1);
  });
});

describe("pointsToCsv", () => {
  it("emits a header and 4-decimal coordinates", () => {
    const points: SurveyPoint[] = [
      { id: "a", pointNo: "1", n: 100, e: 200, z: 5, code: "CP", layerId: "TOPO" },
      { id: "b", pointNo: "2", n: 110, e: 210, z: null, code: "", layerId: "TOPO" },
    ];
    const csv = pointsToCsv(points);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("PointNo,Y,X,Z,Code");
    // Y = Easting (200), X = Northing (100).
    expect(lines[1]).toBe("1,200.0000,100.0000,5.0000,CP");
    expect(lines[2]).toBe("2,210.0000,110.0000,,");
  });

  it("round-trips through parsePointsCsv", () => {
    const points: SurveyPoint[] = [
      { id: "a", pointNo: "1", n: 100, e: 200, z: 5, code: "CP", layerId: "TOPO" },
    ];
    const reparsed = parsePointsCsv(pointsToCsv(points));
    expect(reparsed.points[0]).toEqual({ pointNo: "1", n: 100, e: 200, z: 5, code: "CP" });
  });
});
