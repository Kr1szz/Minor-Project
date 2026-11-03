export type Vec3 = [number, number, number];
export type ComponentType =
  | "tank"
  | "pipe"
  | "curved-pipe"
  | "valve"
  | "tap"
  | "custom";
export type Status = "normal" | "warning" | "failed" | "repaired";
export interface PortDefinition {
  id: string;
  direction: "input" | "output" | "bidirectional";
  position: Vec3;
  vector: Vec3;
  diameter: number;
}
export interface ComponentDefinition {
  type: ComponentType;
  name: string;
  category: string;
  model: string;
  ports: PortDefinition[];
  properties: Record<string, unknown>;
}
export interface ComponentEntity {
  id: string;
  type: ComponentType;
  name: string;
  position: Vec3;
  rotation: number;
  rotation3?: Vec3;
  material: string;
  diameter: number;
  length: number;
  maxPressure: number;
  pressureLoss: number;
  flowResistance: number;
  open: boolean;
  opening: number;
  ports: PortDefinition[];
  status: Status;
  pressure: number;
  flow: number;
  fluid?: string;
  ageDays?: number;
  health?: number;
  lifeDays?: number;
  customAssetId?: string;
}
export interface CustomAsset {
  id: string;
  name: string;
  material: string;
  maxPressure: number;
  description: string;
  ageDays?: number;
  format?: "glb" | "obj" | "fbx";
  fileName?: string;
  dataUrl?: string;
}
export interface Connection {
  id: string;
  fromComponent: string;
  fromPort: string;
  toComponent: string;
  toPort: string;
}
/** Simulation verdict computed by the API (backend/app/simulation.py). */
export interface Diagnostic {
  rootCause: ComponentEntity | null;
  secondaryEffects: ComponentEntity[];
  message: string;
  recommendation: string;
}
