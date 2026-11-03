import * as THREE from 'three';
import type { ComponentType, ComponentEntity, Connection, Vec3 } from './types';
import { catalog } from './catalog';

export type PlacementSnap = { position: Vec3; connection?: Omit<Connection, 'id'> };

/**
 * Snap a placed component's nearest free port onto the nearest free existing port.
 * `position` is the point on the floor; unsnapped parts rest on the floor at their
 * catalog `restingHeight`.
 */
export function snapPlacement(
  type: ComponentType,
  position: Vec3,
  rotation: number | [number, number, number],
  components: ComponentEntity[],
  connections: Connection[],
): PlacementSnap {
  const definition = catalog.find(item => item.type === type);
  position = [position[0], position[1] + Number(definition?.properties.restingHeight ?? 0), position[2]];
  if (!definition?.ports.length) return { position };

  const used = new Set<string>();
  for (const connection of connections) {
    used.add(`${connection.fromComponent}:${connection.fromPort}`);
    used.add(`${connection.toComponent}:${connection.toPort}`);
  }
  const rotationEuler = new THREE.Euler(...(Array.isArray(rotation) ? rotation : [0, rotation, 0]));
  const origin = new THREE.Vector3(...position);
  const candidates = components.flatMap(component => component.ports
    .filter(port => !used.has(`${component.id}:${port.id}`))
    .map(port => ({ component, port, world: new THREE.Vector3(...component.position).add(new THREE.Vector3(...port.position).applyEuler(new THREE.Euler(...(component.rotation3 ?? [0, component.rotation, 0])))) })));

  let best: { distance: number; existing: typeof candidates[number]; portId: string; local: THREE.Vector3 } | undefined;
  for (const port of definition.ports) {
    const local = new THREE.Vector3(...port.position).applyEuler(rotationEuler);
    const world = origin.clone().add(local);
    for (const existing of candidates) {
      const distance = world.distanceTo(existing.world);
      if (distance <= 1.5 && (!best || distance < best.distance)) best = { distance, existing, portId: port.id, local };
    }
  }
  if (!best) return { position };

  const snapped = best.existing.world.clone().sub(best.local);
  return {
    position: [snapped.x, snapped.y, snapped.z],
    connection: {
      fromComponent: best.existing.component.id,
      fromPort: best.existing.port.id,
      toComponent: '__new__',
      toPort: best.portId,
    },
  };
}
