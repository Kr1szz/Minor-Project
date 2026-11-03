import { afterEach, describe, expect, it, vi } from "vitest";
import { catalog } from "../domain/catalog";
import type { ComponentEntity } from "../domain/types";
import { projectApi } from "./api";

const apiComponent = (overrides: Record<string, unknown> = {}) => ({
  id: "pipe-1",
  type: "pipe",
  name: "Pipe",
  position: [0, 0, 0],
  rotation: 0,
  rotation3: [0, 0, 0],
  material: "PVC",
  diameter: .25,
  length: 2,
  max_pressure: 70,
  pressure_loss: 2,
  flow_resistance: 1,
  open: true,
  opening: 1,
  ports: catalog[0].ports,
  properties: {},
  pressure: 0,
  flow: 0,
  status: "normal",
  ...overrides,
});

const respond = (body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

afterEach(() => vi.unstubAllGlobals());

describe("projectApi.simulate", () => {
  it("maps the snake_case diagnostic to the shape the UI reads", async () => {
    const failed = apiComponent({ status: "failed", pressure: 98 });
    vi.stubGlobal("fetch", respond({
      components: [failed],
      diagnostic: {
        root_cause: failed,
        secondary_effects: [apiComponent({ id: "tap-1", type: "tap" })],
        message: "Pipe exceeds its safe operating limit.",
        recommendation: "Replace it.",
      },
      leaks: [],
    }));
    const { diagnostic } = await projectApi.simulate("p", 100);
    expect(diagnostic.rootCause?.id).toBe("pipe-1");
    expect(diagnostic.rootCause?.maxPressure).toBe(70);
    expect(diagnostic.secondaryEffects.map((c) => c.id)).toEqual(["tap-1"]);
    expect(diagnostic.message).toBe("Pipe exceeds its safe operating limit.");
  });

  it("prefers freshly simulated health over values stored in properties", async () => {
    const stale = { health: 100, lifeDays: 3650 };
    vi.stubGlobal("fetch", respond({
      components: [apiComponent({ health: 43, lifeDays: 607, properties: stale })],
      diagnostic: { root_cause: null, secondary_effects: [], message: "", recommendation: "" },
    }));
    const [component] = (await projectApi.simulate("p", 150)).components;
    expect(component.health).toBe(43);
    expect(component.lifeDays).toBe(607);
  });
});

describe("projectApi.updateComponent", () => {
  it("does not persist simulation outputs", async () => {
    const fetchMock = respond({});
    vi.stubGlobal("fetch", fetchMock);
    const component = {
      ...projectApi.fromComponent(apiComponent() as never),
      health: 12,
      lifeDays: 5,
      fluid: "Salt water",
    } as ComponentEntity;
    await projectApi.updateComponent("p", component);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties).not.toHaveProperty("health");
    expect(body.properties).not.toHaveProperty("lifeDays");
    expect(body.properties.fluid).toBe("Salt water");
    expect(body.max_pressure).toBe(70);
  });
});

describe("request errors", () => {
  it("explains how to start the API when it cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(projectApi.getProject("p")).rejects.toThrow(/Can't reach the PipeLab API/);
  });

  it("includes the status and body for API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Project not found", { status: 404 })));
    await expect(projectApi.getProject("p")).rejects.toThrow("API 404: Project not found");
  });
});
