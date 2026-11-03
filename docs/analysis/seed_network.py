"""Seed network and chain generators shared by the benchmarks.

Mirrors the `initial` and `initialConnections` constants in src/state/stores.ts
and the port tables in src/domain/catalog.ts. Keys use the API's snake_case.
"""
from math import pi


def port(port_id, x, y=0.0, z=0.0):
    return {'id': port_id, 'direction': 'bidirectional', 'position': [x, y, z],
            'vector': [(x > 0) - (x < 0), 0, (z > 0) - (z < 0)], 'diameter': 0.25}


PIPE_PORTS = [port('inlet', -1), port('outlet', 1)]
VALVE_PORTS = [port('inlet', -.39), port('outlet', .39)]
TAP_PORTS = [port('inlet', -.5), port('outlet', .34, 0, .23)]
TANK_PORTS = [port('inlet', .59, .25, 0)]


def component(cid, ctype, name, position, rotation3, material, max_pressure,
              flow_resistance, ports, pressure_loss=0.0, diameter=.25, length=1.0):
    return {'id': cid, 'type': ctype, 'name': name, 'position': position, 'rotation': 0,
            'material': material, 'diameter': diameter, 'length': length,
            'max_pressure': max_pressure, 'pressure_loss': pressure_loss,
            'flow_resistance': flow_resistance, 'open': True, 'opening': 1, 'ports': ports,
            'properties': {'rotation3': rotation3, 'fluid': 'Fresh water', 'ageDays': 0}}


def seed_components():
    return [
        component('tank-main', 'tank', 'Water Cylinder', [-4, 1.1, 0], [0, 0, 0], 'Steel', 200, 0, TANK_PORTS, 0, .5, 1),
        component('pipe-main', 'pipe', 'Rising Pipe', [-3.41, 2.35, 0], [0, 0, pi / 2], 'PVC', 70, 1, PIPE_PORTS, 2, .25, 2),
        component('valve-main', 'valve', 'Ball Valve', [-3.02, 3.35, 0], [0, 0, 0], 'Brass', 150, 2, VALVE_PORTS, 1),
        component('pipe-upper', 'pipe', 'Outlet Pipe', [-1.63, 3.35, 0], [0, 0, 0], 'PVC', 70, 1, PIPE_PORTS, 2, .25, 2),
        component('tap-main', 'tap', 'Outlet', [-.13, 3.35, 0], [0, 0, 0], 'Chrome', 120, 1, TAP_PORTS),
    ]


def seed_connections():
    return [
        {'id': 'c1', 'from_component': 'tank-main', 'from_port': 'inlet', 'to_component': 'pipe-main', 'to_port': 'inlet'},
        {'id': 'c2', 'from_component': 'pipe-main', 'from_port': 'outlet', 'to_component': 'valve-main', 'to_port': 'inlet'},
        {'id': 'c3', 'from_component': 'valve-main', 'from_port': 'outlet', 'to_component': 'pipe-upper', 'to_port': 'inlet'},
        {'id': 'c4', 'from_component': 'pipe-upper', 'from_port': 'outlet', 'to_component': 'tap-main', 'to_port': 'inlet'},
    ]


def chain(n, spacing=2.0):
    """A tank, n-2 straight pipes and a tap in series: n components in total."""
    if n < 2:
        raise ValueError('a chain needs a tank and a tap')
    parts = [component('tank-0', 'tank', 'Tank', [0, 0, 0], [0, 0, 0], 'Steel', 200, 0, TANK_PORTS, 0, .5, 1)]
    edges = []
    previous, previous_port = 'tank-0', 'inlet'
    for index in range(1, n):
        is_tap = index == n - 1
        cid = f"{'tap' if is_tap else 'pipe'}-{index}"
        parts.append(component(cid, 'tap' if is_tap else 'pipe', cid, [index * spacing, 0, 0], [0, 0, 0],
                               'Chrome' if is_tap else 'PVC', 120 if is_tap else 70, 1,
                               TAP_PORTS if is_tap else PIPE_PORTS, 0 if is_tap else 2))
        edges.append({'id': f'e{index}', 'from_component': previous, 'from_port': previous_port,
                      'to_component': cid, 'to_port': 'inlet'})
        previous, previous_port = cid, 'outlet'
    return parts, edges
