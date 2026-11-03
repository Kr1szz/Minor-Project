import os
import tempfile
from math import pi
from pathlib import Path

import pytest

# Point the app at a throwaway SQLite file before app.database is imported.
os.environ['DATABASE_URL'] = f"sqlite:///{Path(tempfile.mkdtemp()) / 'test.db'}"


def port(port_id, x, y=0.0, z=0.0):
    return {'id': port_id, 'direction': 'bidirectional', 'position': [x, y, z], 'vector': [1, 0, 0], 'diameter': .25}


def component(component_id, kind, position, ports, rotation3=(0, 0, 0), **fields):
    return {
        'id': component_id, 'type': kind, 'name': component_id, 'position': list(position),
        'rotation': 0, 'rotation3': list(rotation3), 'ports': ports, 'properties': {},
        'max_pressure': 70, 'pressure_loss': 0, 'flow_resistance': 1, 'open': True, 'opening': 1,
        **fields,
    }


@pytest.fixture
def starter():
    """The editor's starter network (src/state/stores.ts): tank, rising pipe, valve, pipe, tap."""
    components = [
        component('tank-main', 'tank', (-4, 1.1, 0), [port('inlet', .59, .25)], max_pressure=200),
        component('pipe-main', 'pipe', (-3.41, 2.35, 0), [port('inlet', -1), port('outlet', 1)],
                  rotation3=(0, 0, pi / 2), pressure_loss=2),
        component('valve-main', 'valve', (-3.02, 3.35, 0), [port('inlet', -.39), port('outlet', .39)],
                  max_pressure=150, pressure_loss=1, flow_resistance=2),
        component('pipe-upper', 'pipe', (-1.63, 3.35, 0), [port('inlet', -1), port('outlet', 1)], pressure_loss=2),
        component('tap-main', 'tap', (-.13, 3.35, 0), [port('inlet', -.5), port('outlet', .34, 0, .23)], max_pressure=120),
    ]
    connections = [
        {'from_component': 'tank-main', 'from_port': 'inlet', 'to_component': 'pipe-main', 'to_port': 'inlet'},
        {'from_component': 'pipe-main', 'from_port': 'outlet', 'to_component': 'valve-main', 'to_port': 'inlet'},
        {'from_component': 'valve-main', 'from_port': 'outlet', 'to_component': 'pipe-upper', 'to_port': 'inlet'},
        {'from_component': 'pipe-upper', 'from_port': 'outlet', 'to_component': 'tap-main', 'to_port': 'inlet'},
    ]
    return components, connections
