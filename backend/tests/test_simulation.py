from app.simulation import run_simulation


def by_id(result):
    return {c['id']: c for c in result['components']}


def test_diagnostic_keys_match_the_api_contract(starter):
    # The frontend maps these snake_case keys to rootCause/secondaryEffects.
    result = run_simulation(*starter, 40)
    assert set(result['diagnostic']) == {'root_cause', 'secondary_effects', 'message', 'recommendation'}


def test_starter_network_is_healthy_at_40_psi(starter):
    result = run_simulation(*starter, 40)
    assert result['diagnostic']['root_cause'] is None
    assert all(c['status'] == 'normal' for c in result['components'])
    # Only the open tap's outlet discharges; every joint is connected.
    assert [leak['kind'] for leak in result['leaks']] == ['outlet']


def test_overpressure_fails_the_lowest_rated_part(starter):
    result = run_simulation(*starter, 150)
    assert result['diagnostic']['root_cause']['type'] == 'pipe'
    assert by_id(result)['pipe-main']['status'] == 'failed'
    assert any(leak['kind'] == 'break' for leak in result['leaks'])


def test_closed_valve_isolates_everything_downstream(starter):
    components, connections = starter
    next(c for c in components if c['id'] == 'valve-main')['open'] = False
    result = by_id(run_simulation(components, connections, 40))
    assert result['valve-main']['pressure'] > 0
    assert result['valve-main']['flow'] == 0
    assert result['pipe-upper']['pressure'] == 0
    assert result['tap-main']['flow'] == 0


def test_zero_source_pressure_reports_no_leaks(starter):
    assert run_simulation(*starter, 0)['leaks'] == []


def test_simulated_health_drops_with_pressure(starter):
    low = by_id(run_simulation(*starter, 20))
    high = by_id(run_simulation(*starter, 150))
    assert low['pipe-upper']['health'] == 100
    assert high['pipe-upper']['health'] < 50


def test_pressure_never_rises_downstream(starter):
    result = by_id(run_simulation(*starter, 40))
    path = ['tank-main', 'pipe-main', 'valve-main', 'pipe-upper', 'tap-main']
    pressures = [result[c]['pressure'] for c in path]
    assert pressures == sorted(pressures, reverse=True)
    # Each part's inlet sees the source minus the losses upstream of it: 2 + 1 + 2.
    assert result['tap-main']['pressure'] == 35


def test_pressure_loss_comes_from_each_component(starter):
    components, connections = starter
    next(c for c in components if c['id'] == 'valve-main')['pressure_loss'] = 10
    assert by_id(run_simulation(components, connections, 40))['tap-main']['pressure'] == 40 - (2 + 10 + 2)


def test_moving_a_part_out_of_line_breaks_the_joint(starter):
    components, connections = starter
    next(c for c in components if c['id'] == 'pipe-upper')['position'][2] += 1
    result = run_simulation(components, connections, 40)
    components_by_id = by_id(result)
    assert components_by_id['pipe-upper']['pressure'] == 0
    assert components_by_id['tap-main']['pressure'] == 0
    assert {'component_id': 'valve-main', 'port_id': 'outlet', 'kind': 'leak'}.items() <= next(
        leak for leak in result['leaks'] if leak['component_id'] == 'valve-main').items()


def test_detached_rising_pipe_leaks_from_the_tank(starter):
    components, connections = starter
    next(c for c in components if c['id'] == 'pipe-main')['position'][0] += 2
    leaks = run_simulation(components, connections, 40)['leaks']
    assert [(leak['component_id'], leak['kind']) for leak in leaks] == [('tank-main', 'leak')]


def test_port_positions_follow_three_js_euler_order():
    from math import pi

    from app.simulation import port_world_position
    part = {'position': [0, 0, 0], 'rotation3': [pi / 2, pi / 2, 0]}
    # three.js: new Vector3(1, 0, 0).applyEuler(new Euler(PI / 2, PI / 2, 0)) -> (0, 1, 0)
    assert [round(v, 6) + 0 for v in port_world_position(part, {'position': [1, 0, 0]})] == [0, 1, 0]


def test_open_tap_is_not_reported_as_a_leak(starter):
    assert run_simulation(*starter, 40)['diagnostic']['message'] == 'All connected components are within their pressure ratings.'
