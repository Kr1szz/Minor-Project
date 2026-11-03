import type { ComponentDefinition, ComponentType, PortDefinition } from './types';
const ports = (type: ComponentType): PortDefinition[] => {
  const p = (id: string, x: number, z = 0, y = 0): PortDefinition => ({ id, direction: 'bidirectional', position: [x, y, z], vector: [Math.sign(x), 0, Math.sign(z)], diameter: 0.25 });
  if (type === 'curved-pipe') return [p('inlet', -.62), p('outlet', 0, -.62)];
  if (type === 'tank') return [p('inlet', .59, 0, .25)];
  if (type === 'tap') return [p('inlet', -.5), p('outlet', .34, .23)];
  if (type === 'valve') return [p('inlet', -.39), p('outlet', .39)];
  return [p('inlet', -1), p('outlet', 1)];
};
export const catalog: ComponentDefinition[] = [
  { type: 'pipe', name: 'PVC Pipe', category: 'Pipe', model: 'pipe', ports: ports('pipe'), properties: { material: 'PVC', maxPressure: 70, diameter: 0.25, length: 2, restingHeight: .17, description: 'Straight hollow tube that carries water between two fittings.' } },
  { type: 'curved-pipe', name: '90° Elbow', category: 'Pipe', model: 'elbow', ports: ports('curved-pipe'), properties: { material: 'PVC', maxPressure: 70, diameter: 0.25, length: 1.2, restingHeight: .17, description: 'A quarter turn elbow routes the pipe around a corner.' } },
  { type: 'valve', name: 'Ball Valve', category: 'Valve', model: 'valve', ports: ports('valve'), properties: { material: 'Brass', maxPressure: 150, opening: 1, restingHeight: .22, description: 'Opens or stops flow through a line.' } },
  { type: 'tap', name: 'Outlet Tap', category: 'Device', model: 'tap', ports: ports('tap'), properties: { material: 'Chrome', maxPressure: 120, restingHeight: .2, description: 'A terminal outlet that releases water from the network.' } },
  { type: 'tank', name: 'Pressure Tank', category: 'Source', model: 'tank', ports: ports('tank'), properties: { material: 'Steel', maxPressure: 200, pressure: 40, restingHeight: 1.1, description: 'Pressurized water source for the network.' } },
  { type: 'custom', name: 'Custom object', category: 'Custom', model: 'custom', ports: ports('pipe'), properties: { material: 'Steel', maxPressure: 100, diameter: 0.25, length: 1, restingHeight: .24, description: 'A user-defined inline component.' } },
];
