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
