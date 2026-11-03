import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { snapPlacement } from "./placement";
import type { ComponentEntity, Connection } from "./types";

const pipe = (id: string, x: number): ComponentEntity => ({
  id,
  type: "pipe",
  name: id,
  position: [x, 0, 0],
  rotation: 0,
  material: "PVC",
  diameter: .25,
  length: 2,
  maxPressure: 70,
  pressureLoss: 2,
  flowResistance: 1,
  open: true,
  opening: 1,
  ports: catalog[0].ports,
  status: "normal",
  pressure: 0,
  flow: 0,
});

describe("snapPlacement", () => {
  it("snaps the nearest new port onto a free existing port", () => {
    // Existing pipe at x=0 has its outlet at x=1; a new pipe dropped near x=2.3
    // should land with its inlet (local x=-1) on that outlet, i.e. at x=2.
    const snap = snapPlacement("pipe", [2.3, 0, .2], 0, [pipe("a", 0)], []);
    expect(snap.position[0]).toBeCloseTo(2);
    expect(snap.position[2]).toBeCloseTo(0);
    expect(snap.connection).toMatchObject({
      fromComponent: "a",
      fromPort: "outlet",
      toPort: "inlet",
    });
  });

  it("ignores ports that are already connected", () => {
    const used: Connection[] = [{
      id: "c",
      fromComponent: "a",
      fromPort: "outlet",
      toComponent: "b",
      toPort: "inlet",
    }];
    const snap = snapPlacement("pipe", [2.3, 0, 0], 0, [pipe("a", 0), pipe("b", 2)], used);
    expect(snap.connection?.fromComponent).toBe("b");
  });

  it("keeps the dropped position when no port is within reach", () => {
    const snap = snapPlacement("pipe", [10, 0, 10], 0, [pipe("a", 0)], []);
    // Unsnapped parts rest on the floor at their catalog height.
    expect(snap).toEqual({ position: [10, .17, 10] });
  });
});
