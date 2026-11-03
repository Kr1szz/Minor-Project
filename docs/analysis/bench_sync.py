"""E3-E6: round-trip, fan-out, convergence and join-during-broadcast tests.

Runs against a live API on one host. Every latency uses one monotonic clock in
this process, so no clock synchronisation is involved. Nothing here instruments
the server: all figures are client-observed.

Usage: python bench_sync.py <results-dir> [e3 e4 e5 e6]
"""
import asyncio
import csv
import json
import sys
import time
import uuid
from pathlib import Path

import httpx
import websockets

sys.path.insert(0, str(Path(__file__).parent))
from seed_network import seed_components, seed_connections  # noqa: E402

API = 'http://127.0.0.1:8000'
WS = 'ws://127.0.0.1:8000'
CLIENT_COUNTS = [1, 2, 5, 10, 25, 50]
UPDATES = 330
WARMUP = 30
RUNS = 3
TIMEOUT = 30.0
now = time.perf_counter

results = Path(sys.argv[1])
results.mkdir(parents=True, exist_ok=True)
wanted = set(sys.argv[2:]) or {'e3', 'e4', 'e5', 'e6'}


def percentile(values, q):
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def write(name, header, rows):
    with open(results / name, 'w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


async def new_project(http):
    """Create an isolated project. Component ids are global keys, so they get a suffix."""
    project = (await http.post('/projects', json={'name': 'bench'})).raise_for_status().json()
    tag = uuid.uuid4().hex[:8]
    renamed = {}
    for component in seed_components():
        renamed[component['id']] = f"{component['id']}-{tag}"
        component['id'] = renamed[component['id']]
        (await http.post(f"/projects/{project['id']}/components", json=component)).raise_for_status()
    for edge in seed_connections():
        edge = {**edge, 'id': f"{edge['id']}-{tag}", 'from_component': renamed[edge['from_component']],
                'to_component': renamed[edge['to_component']]}
        (await http.post(f"/projects/{project['id']}/connections", json=edge)).raise_for_status()
    return project['id'], renamed['valve-main']


async def get_component(http, project_id, component_id):
    project = (await http.get(f'/projects/{project_id}')).raise_for_status().json()
    return next(c for c in project['components'] if c['id'] == component_id)


class Subscriber:
    """A peer client. mode 'refetch' does what src/state/stores.ts does on an event."""

    def __init__(self, project_id, http, refetch):
        self.project_id, self.http, self.refetch = project_id, http, refetch
        self.expected = None
        self.socket = None
        self.task = None

    async def start(self):
        self.socket = await websockets.connect(f'{WS}/ws/projects/{self.project_id}', ping_interval=None)
        self.task = asyncio.create_task(self.read())

    async def read(self):
        try:
            async for message in self.socket:
                pending = self.expected
                if pending and pending['marker'] in message:
                    pending['size'] = len(message)
                    arrived = now()
                    if self.refetch:
                        (await self.http.get(f'/projects/{self.project_id}')).raise_for_status()
                    pending['samples'].append((now() if self.refetch else arrived) - pending['start'])
                    pending['left'] -= 1
                    if pending['left'] == 0:
                        pending['done'].set()
        except websockets.ConnectionClosed:
            pass
        except Exception as error:
            # A silently dead reader would otherwise cost one timeout per update.
            print('peer reader failed:', repr(error), flush=True)
            raise

    async def stop(self):
        await self.socket.close()
        self.task.cancel()


async def e3(http):
    project_id, _ = await new_project(http)
    samples = []
    size = 0
    for i in range(1050):
        start = now()
        response = await http.post(f'/projects/{project_id}/simulate', json={'source_pressure': 40})
        response.raise_for_status()
        elapsed = now() - start
        size = len(response.content)
        if i >= 50:
            samples.append(elapsed * 1e3)
        await asyncio.sleep(.005)
    write('e3_simulate_rtt.csv', ['n', 'p50_ms', 'p95_ms', 'p99_ms', 'max_ms', 'response_bytes'],
          [[len(samples), percentile(samples, .5), percentile(samples, .95), percentile(samples, .99), max(samples), size]])


async def fanout_trial(http, project_id, valve, peers, mode, index):
    marker = f'bench-{uuid.uuid4().hex}'
    pending = {'marker': marker, 'samples': [], 'left': len(peers), 'done': asyncio.Event(), 'start': 0.0, 'size': 0}
    for peer in peers:
        peer.expected = pending
    if mode == 'simulation':
        # The result echoes every component, so the marker travels in the valve's name.
        valve['name'] = marker
        (await http.put(f"/projects/{project_id}/components/{valve['id']}", json=valve)).raise_for_status()
        pending['left'] = len(peers)
        pending['start'] = now()
        (await http.post(f'/projects/{project_id}/simulate', json={'source_pressure': 40})).raise_for_status()
    else:
        valve['name'] = marker
        valve['open'] = index % 2 == 0
        pending['start'] = now()
        (await http.put(f"/projects/{project_id}/components/{valve['id']}", json=valve)).raise_for_status()
    await asyncio.wait_for(pending['done'].wait(), TIMEOUT)
    return pending


async def e4(http):
    # Resumable: series already pooled in the results file are kept and skipped.
    existing = results / 'e4_fanout.csv'
    rows = []
    finished = set()
    if existing.exists():
        with open(existing) as handle:
            saved = list(csv.reader(handle))[1:]
        finished = {(r[0], int(r[1])) for r in saved if r[2] == 'pooled'}
        rows = [r for r in saved if (r[0], int(r[1])) in finished]
    mode_names = {'event': False, 'event_get': True, 'simulation': False}
    limits = httpx.Limits(max_connections=None, max_keepalive_connections=None)
    async with httpx.AsyncClient(base_url=API, timeout=TIMEOUT, limits=limits) as peer_http:
        for mode, refetch in mode_names.items():
            for clients in CLIENT_COUNTS:
                if (mode, clients) in finished:
                    continue
                pooled, last_peer, delivered, timeouts, size = [], [], 0, 0, 0
                for run in range(RUNS):
                    project_id, valve_id = await new_project(http)
                    valve = await get_component(http, project_id, valve_id)
                    peers = [Subscriber(project_id, peer_http, refetch) for _ in range(clients)]
                    await asyncio.gather(*(p.start() for p in peers))
                    await asyncio.sleep(.3)
                    samples, worst = [], []
                    for i in range(UPDATES):
                        try:
                            pending = await fanout_trial(http, project_id, valve, peers, mode, i)
                            delivered += len(pending['samples'])
                            size = pending['size']
                            if i >= WARMUP:
                                samples += pending['samples']
                                worst.append(max(pending['samples']))
                        except asyncio.TimeoutError:
                            timeouts += 1
                        await asyncio.sleep(.02)
                    await asyncio.gather(*(p.stop() for p in peers))
                    pooled += samples
                    last_peer += worst
                    rows.append([mode, clients, run, len(samples), *(percentile(samples, q) * 1e3 for q in (.5, .95, .99)),
                                 max(samples) * 1e3, percentile(worst, .5) * 1e3, percentile(worst, .95) * 1e3, delivered, timeouts, size])
                rows.append([mode, clients, 'pooled', len(pooled), *(percentile(pooled, q) * 1e3 for q in (.5, .95, .99)),
                             max(pooled) * 1e3, percentile(last_peer, .5) * 1e3, percentile(last_peer, .95) * 1e3, delivered, timeouts, size])
                print(mode, clients, [round(x, 2) if isinstance(x, float) else x for x in rows[-1][3:]], flush=True)
                write('e4_fanout.csv', ['mode', 'clients', 'run', 'n', 'p50_ms', 'p95_ms', 'p99_ms', 'max_ms',
                                        'last_peer_p50_ms', 'last_peer_p95_ms', 'delivered', 'timeouts', 'event_bytes'], rows)


async def e5(http):
    rows = []
    project_id, valve_id = await new_project(http)

    async def edit(snapshot, **changes):
        body = {**snapshot, **changes}
        (await http.put(f'/projects/{project_id}/components/{valve_id}', json=body)).raise_for_status()

    async def trial(arm, index):
        start = await get_component(http, project_id, valve_id)
        wanted_open = not start['open']
        wanted_x = start['position'][0] + 1
        position = [wanted_x, *start['position'][1:]]
        if arm == 'concurrent_stale':
            await asyncio.gather(edit(start, open=wanted_open), edit(start, position=position))
        elif arm == 'sequential_stale':
            await edit(start, open=wanted_open)
            await edit(start, position=position)
        else:
            await edit(start, open=wanted_open)
            await edit(await get_component(http, project_id, valve_id), position=position)
        final = await get_component(http, project_id, valve_id)
        return final['open'] == wanted_open, final['position'][0] == wanted_x

    for arm in ('concurrent_stale', 'sequential_stale', 'sequential_fresh'):
        trials = 500
        open_lost = position_lost = both_kept = 0
        for index in range(trials):
            kept_open, kept_position = await trial(arm, index)
            open_lost += not kept_open
            position_lost += not kept_position
            both_kept += kept_open and kept_position
        rows.append([arm, trials, both_kept, open_lost, position_lost, trials - both_kept])
    write('e5_lost_update.csv', ['arm', 'trials', 'both_edits_kept', 'open_edit_lost', 'position_edit_lost', 'trials_with_loss'], rows)

    # Events sent while a client is away, and what a reconnect returns.
    rows = []
    trials, edits = 20, 20
    missed = replayed = control_received = stale_after_reconnect = 0
    valve = await get_component(http, project_id, valve_id)
    for _ in range(trials):
        received = []

        async def collect(socket):
            try:
                async for message in socket:
                    received.append(json.loads(message)['type'])
            except websockets.ConnectionClosed:
                pass

        online = await websockets.connect(f'{WS}/ws/projects/{project_id}', ping_interval=None)
        online_seen = []

        async def collect_online():
            try:
                async for message in online:
                    online_seen.append(message)
            except websockets.ConnectionClosed:
                pass

        online_task = asyncio.create_task(collect_online())
        await asyncio.sleep(.05)
        before = await get_component(http, project_id, valve_id)
        for i in range(edits):
            valve['open'] = i % 2 == 0
            valve['name'] = f'edit-{uuid.uuid4().hex}'
            (await http.put(f'/projects/{project_id}/components/{valve_id}', json=valve)).raise_for_status()
        await asyncio.sleep(.2)
        control_received += len(online_seen)
        missed += edits
        socket = await websockets.connect(f'{WS}/ws/projects/{project_id}', ping_interval=None)
        reader = asyncio.create_task(collect(socket))
        await asyncio.sleep(.5)
        replayed += len(received)
        latest = await get_component(http, project_id, valve_id)
        stale_after_reconnect += latest['name'] != before['name']
        await socket.close()
        await online.close()
        reader.cancel()
        online_task.cancel()
    write('e5_reconnect.csv', ['trials', 'edits_per_trial', 'events_sent_while_away', 'events_replayed_after_reconnect',
                               'control_events_received', 'trials_state_differs_without_refetch'],
          [[trials, edits, missed, replayed, control_received, stale_after_reconnect]])


async def e6(http):
    """Sockets join and leave while another client broadcasts as fast as it can."""
    project_id, valve_id = await new_project(http)
    valve = await get_component(http, project_id, valve_id)
    stable = [Subscriber(project_id, http, False) for _ in range(25)]
    await asyncio.gather(*(p.start() for p in stable))
    deadline = now() + 60
    counts = {'updates': 0, 'errors': 0, 'joins': 0}

    async def writer():
        while now() < deadline:
            valve['open'] = not valve['open']
            response = await http.put(f'/projects/{project_id}/components/{valve_id}', json=valve)
            counts['updates'] += 1
            counts['errors'] += response.status_code >= 500

    async def churn():
        while now() < deadline:
            socket = await websockets.connect(f'{WS}/ws/projects/{project_id}', ping_interval=None)
            counts['joins'] += 1
            await socket.close()

    await asyncio.gather(writer(), *(churn() for _ in range(8)))
    await asyncio.gather(*(p.stop() for p in stable))
    write('e6_churn.csv', ['duration_s', 'stable_clients', 'updates', 'http_5xx', 'socket_joins'],
          [[60, 25, counts['updates'], counts['errors'], counts['joins']]])
    print(counts)


async def main():
    async with httpx.AsyncClient(base_url=API, timeout=TIMEOUT) as http:
        for name, run in (('e3', e3), ('e4', e4), ('e5', e5), ('e6', e6)):
            if name in wanted:
                print('running', name, flush=True)
                await run(http)


asyncio.run(main())
