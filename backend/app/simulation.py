import heapq
from math import cos, sin

# Fallback pressure loss (psi) per component when a record has none stored.
DEFAULT_PRESSURE_LOSS = {'pipe': 2.0, 'curved-pipe': 2.0, 'custom': 2.0, 'valve': 1.0}

def port_world_position(component: dict, port: dict) -> tuple[float, float, float]:
    position = component.get('position', [0, 0, 0]); local = port.get('position', [0, 0, 0])
    rotation = component.get('rotation3') or [0, component.get('rotation', 0), 0]
    x, y, z = local; rx, ry, rz = rotation
    # Three.js Euler order 'XYZ' (the renderer's default) applies Z, then Y, then X.
    x, y = x*cos(rz)-y*sin(rz), x*sin(rz)+y*cos(rz)
    x, z = x*cos(ry)+z*sin(ry), -x*sin(ry)+z*cos(ry)
    y, z = y*cos(rx)-z*sin(rx), y*sin(rx)+z*cos(rx)
    return (position[0]+x, position[1]+y, position[2]+z)

def connection_is_aligned(edge: dict, by_id: dict) -> bool:
    a, b = by_id.get(edge.get('from_component')), by_id.get(edge.get('to_component'))
    if not a or not b: return False
    ports_a = {p.get('id'):p for p in a.get('ports', [])}; ports_b = {p.get('id'):p for p in b.get('ports', [])}
    pa, pb = ports_a.get(edge.get('from_port')), ports_b.get(edge.get('to_port'))
    if not pa or not pb: return False
    wa, wb = port_world_position(a, pa), port_world_position(b, pb)
    return sum((x-y)**2 for x,y in zip(wa,wb))**.5 <= .2

def run_simulation(components: list[dict], connections: list[dict], source_pressure: float) -> dict:
    """Deterministic graph propagation; deliberately independent of any rendering engine."""
    by_id = {c['id']: c for c in components}
    adjacency: dict[str, list[str]] = {key: [] for key in by_id}
    valid_connections = []
    for edge in connections:
        # A joint only carries water while its two ports meet; a part dragged
        # out of line leaves an open, leaking port instead.
        if connection_is_aligned(edge, by_id):
            a, b = edge['from_component'], edge['to_component']
            adjacency[a].append(b); adjacency[b].append(a)
            valid_connections.append(edge)
    source = next((c['id'] for c in components if c['type'] == 'tank'), components[0]['id'] if components else None)
    # Pressure lost between the source and each component's inlet: the sum of
    # the pressure_loss of every upstream part, along the path that loses least.
    upstream_loss: dict[str, float] = {}
    if source:
        frontier = [(0.0, source)]
        while frontier:
            loss, current = heapq.heappop(frontier)
            if current in upstream_loss: continue
            upstream_loss[current] = loss
            component = by_id[current]
            # A closed valve or tap remains pressurized on its inlet side, but
            # it isolates every component beyond its outlet from the source.
            if component['type'] in ('valve', 'tap') and not component.get('open', True):
                continue
            own_loss = 0.0 if component['type'] == 'tank' else max(0.0, float(component.get('pressure_loss', DEFAULT_PRESSURE_LOSS.get(component['type'], 0.0))))
            for neighbor in adjacency[current]:
                if neighbor not in upstream_loss:
                    heapq.heappush(frontier, (loss + own_loss, neighbor))
    output = []
    for c in components:
        connected = c['id'] in upstream_loss
        pressure = max(0.0, source_pressure - upstream_loss[c['id']]) if connected else 0
        fluid_factor = {'Fresh water': 1.0, 'Hard water': .72, 'Salt water': .42, 'Waste water': .55}.get(c.get('fluid', 'Fresh water'), .8)
        age_days = max(0, float(c.get('ageDays', 0)))
        pressure_ratio = pressure / max(1, float(c.get('max_pressure', 70)))
        health = max(0, min(100, 100 - age_days / 36.5 / fluid_factor - max(0, pressure_ratio - .55) * 38 / fluid_factor))
        life_days = max(0, round((health / 100) * 3650 * fluid_factor / max(1, pressure_ratio * 1.25)))
        status = 'failed' if connected and (pressure > c.get('max_pressure', 70) or health < 12) else 'warning' if connected and (pressure > c.get('max_pressure', 70) * .82 or health < 35) else 'normal'
        flow = pressure / max(1, float(c.get('flow_resistance', 1))) * float(c.get('opening', 1)) if connected and c.get('open', True) and c['type'] != 'tank' else 0
        output.append({**c, 'pressure': pressure, 'flow': flow, 'status': status, 'health': round(health, 1), 'lifeDays': life_days})
    pressure_by_id = {c['id']: c['pressure'] for c in output}
    leaks = []
    used_ports = {(e['from_component'], e['from_port']) for e in valid_connections} | {(e['to_component'], e['to_port']) for e in valid_connections}
    for component in components:
        if component['id'] not in upstream_loss or not component.get('open', True): continue
        # An exposed port is only a water leak while there is pressure to drive
        # water through it. At zero source pressure it remains a disconnected
        # port, but must not create a leak diagnosis or a water jet.
        component_pressure = pressure_by_id[component['id']]
        if component_pressure <= 0: continue
        if component['type'] == 'tap' and component.get('open', True):
            outlet = next((p for p in component.get('ports', []) if p.get('id') == 'outlet'), None)
            if outlet:
                leaks.append({'component_id': component['id'], 'port_id': outlet['id'], 'position': port_world_position(component, outlet), 'pressure': component_pressure, 'kind': 'outlet'})
        for port in component.get('ports', []):
            if (component['id'], port.get('id')) not in used_ports:
                if component['type'] == 'tap' and port.get('id') == 'outlet': continue
                leaks.append({'component_id': component['id'], 'port_id': port.get('id'), 'position': port_world_position(component, port), 'pressure': component_pressure, 'kind': 'leak'})
    for component in components:
        if component['id'] not in upstream_loss or component['type'] not in ('pipe', 'curved-pipe', 'valve'):
            continue
        pressure = pressure_by_id[component['id']]
        if pressure > 0 and pressure >= float(component.get('max_pressure', 70)):
            center = component.get('position', [0, 0, 0])
            leaks.append({'component_id': component['id'], 'port_id': 'body', 'position': (center[0], center[1], center[2]), 'pressure': pressure, 'kind': 'break', 'severity': pressure / max(1,float(component.get('max_pressure',70)))})
    # An open tap discharging is normal operation, not a leak.
    escaping = [leak for leak in leaks if leak['kind'] != 'outlet']
    failed = next((c for c in output if c['status'] == 'failed'), None)
    weak = next((c for c in output if c.get('health', 100) < 35), None)
    diagnosis = {'root_cause': failed or weak, 'secondary_effects': [c for c in output if c['type'] == 'tap' and c['id'] in upstream_loss] if (failed or weak) else [], 'message': f"{failed['name']} exceeds its safe operating limit." if failed else f"{weak['name']} has only {weak['health']}% health remaining." if weak else f'{len(escaping)} open pressurized port(s) are leaking.' if escaping else 'All connected components are within their pressure ratings.', 'recommendation': 'Replace with a higher-rated component and reduce source pressure.' if failed else f"Schedule replacement within {weak['lifeDays']} days; {weak.get('fluid','water')} is accelerating wear." if weak else 'Connect or cap each open port.' if escaping else 'System operating within rated limits.'}
    return {'components': output, 'diagnostic': diagnosis, 'leaks': leaks}
