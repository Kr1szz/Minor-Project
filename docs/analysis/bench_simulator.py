"""E1 and E2: behaviour and scaling of backend/app/simulation.py.

Usage: python bench_simulator.py <path-to-backend> <results-dir>
"""
import copy
import csv
import math
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, sys.argv[1])
from app.simulation import run_simulation  # noqa: E402
from seed_network import chain, seed_components, seed_connections  # noqa: E402

results = Path(sys.argv[2])
results.mkdir(parents=True, exist_ok=True)


def write(name, header, rows):
    with open(results / name, 'w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def simulate(pressure, components=None):
    return run_simulation(components or seed_components(), seed_connections(), pressure)


# E1a: profile along the path at the default source pressure.
result = simulate(40)
write('e1_profile.csv', ['order', 'id', 'type', 'pressure_psi', 'flow', 'status', 'health'],
      [[i, c['id'], c['type'], c['pressure'], c['flow'], c['status'], c['health']]
       for i, c in enumerate(result['components'])])
write('e1_diagnostic.csv', ['pressure', 'message', 'recommendation', 'leak_kinds'],
      [[40, result['diagnostic']['message'], result['diagnostic']['recommendation'],
        ' '.join(sorted(l['kind'] for l in result['leaks']))]])

# E1b: status of each component over the API's accepted range (0-300 psi).
rows = []
onset = {}
for tenth in range(0, 3001):
    pressure = tenth / 10
    for c in simulate(pressure)['components']:
        rows.append([pressure, c['id'], c['pressure'], c['status']])
        onset.setdefault((c['id'], c['status']), pressure)
write('e1_sweep.csv', ['source_psi', 'id', 'pressure_psi', 'status'], rows[::5 * 10])
write('e1_onset.csv', ['id', 'status', 'first_source_psi'],
      [[cid, status, value] for (cid, status), value in onset.items()])

# E1c: closing the valve at 40 psi.
closed = seed_components()
next(c for c in closed if c['id'] == 'valve-main')['open'] = False
result = simulate(40, closed)
write('e1_closed_valve.csv', ['id', 'pressure_psi', 'flow', 'status'],
      [[c['id'], c['pressure'], c['flow'], c['status']] for c in result['components']])

# E2: runtime against network size.
SIZES = [5, 10, 25, 50, 100, 250, 500, 1000, 2000]
rows = []
for n in SIZES:
    parts, edges = chain(n)
    # Keep total work comparable across sizes while staying above timer noise.
    repeats = max(15, min(400, 4000 // n))
    samples = []
    for _ in range(repeats):
        fresh = copy.deepcopy(parts)
        start = time.perf_counter_ns()
        run_simulation(fresh, edges, 40)
        samples.append((time.perf_counter_ns() - start) / 1e6)
    samples.sort()
    rows.append([n, repeats, statistics.median(samples), samples[int(.95 * (len(samples) - 1))], samples[0]])
write('e2_scaling.csv', ['n', 'repeats', 'median_ms', 'p95_ms', 'min_ms'], rows)


def slope(points):
    xs, ys = zip(*[(math.log(n), math.log(ms)) for n, ms in points])
    mean_x, mean_y = statistics.mean(xs), statistics.mean(ys)
    return sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / sum((x - mean_x) ** 2 for x in xs)


points = [(r[0], r[2]) for r in rows]
write('e2_fit.csv', ['range', 'log_log_slope'],
      [['all', slope(points)], ['n>=100', slope([p for p in points if p[0] >= 100])]])
print('profile, sweep and scaling written to', results)
