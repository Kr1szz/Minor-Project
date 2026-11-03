from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def new_project():
    return client.post('/projects', json={'name': 'Test'}).json()['id']


def seed(project_id, components, connections):
    for c in components:
        body = {k: v for k, v in c.items() if k != 'rotation3'}
        body['id'] = f"{project_id[:8]}-{c['id']}"  # component ids are global primary keys
        body['properties'] = {'rotation3': c['rotation3']}
        assert client.post(f'/projects/{project_id}/components', json=body).status_code == 200
    for edge in connections:
        edge = {**edge, 'from_component': f"{project_id[:8]}-{edge['from_component']}",
                'to_component': f"{project_id[:8]}-{edge['to_component']}"}
        assert client.post(f'/projects/{project_id}/connections', json=edge).status_code == 200


def test_health():
    assert client.get('/health').json()['status'] == 'ok'


def test_connection_without_ports_is_rejected():
    project_id = new_project()
    response = client.post(f'/projects/{project_id}/connections',
                           json={'from_component': 'a', 'to_component': 'b', 'to_port': 'inlet'})
    assert response.status_code == 422


def test_connection_gets_an_id_when_none_is_sent():
    project_id = new_project()
    response = client.post(f'/projects/{project_id}/connections',
                           json={'from_component': 'a', 'from_port': 'outlet', 'to_component': 'b', 'to_port': 'inlet'})
    assert response.status_code == 200
    assert response.json()['id']


def test_simulate_round_trip(starter):
    project_id = new_project()
    seed(project_id, *starter)
    result = client.post(f'/projects/{project_id}/simulate', json={'source_pressure': 150}).json()
    assert result['diagnostic']['root_cause']['type'] == 'pipe'
    assert client.get(f'/projects/{project_id}/diagnostics').json() == result['diagnostic']


def test_simulate_rejects_out_of_range_pressure():
    project_id = new_project()
    assert client.post(f'/projects/{project_id}/simulate', json={'source_pressure': 500}).status_code == 422


def test_deleting_a_component_removes_its_connections(starter):
    project_id = new_project()
    seed(project_id, *starter)
    client.delete(f'/projects/{project_id}/components/{project_id[:8]}-valve-main')
    project = client.get(f'/projects/{project_id}').json()
    assert len(project['components']) == 4
    assert all('valve-main' not in (c['from_component'] + c['to_component']) for c in project['connections'])
