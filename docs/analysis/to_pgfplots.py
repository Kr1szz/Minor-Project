"""Write measured results into the generated block of Minor_Project.tex.

Every plotted point and every number quoted in the text comes from a macro or
table defined here, so the paper cannot drift from results/*.csv. The block sits
between the BEGIN and END markers, which keeps the .tex a single compilable file.

Usage: python to_pgfplots.py <results-dir> <tex-file>
"""
import csv
import re
import sys
from pathlib import Path

results, tex = Path(sys.argv[1]), Path(sys.argv[2])
BEGIN, END = '%%% BEGIN GENERATED DATA', '%%% END GENERATED DATA'
LIMIT_PSI = 300
out = []


def rows(name):
    with open(results / name) as handle:
        return list(csv.DictReader(handle))


def macro(name, value):
    out.append(f'\\newcommand{{\\{name}}}{{{value}}}')


def table(name, header, data):
    body = '\n'.join(' '.join(str(cell) for cell in row) for row in data)
    out.append(f"\\pgfplotstableread{{\n{' '.join(header)}\n{body}\n}}\\{name}")


def num(value, digits=1):
    return f'{float(value):.{digits}f}'


def whole(value):
    return f'{round(float(value)):,}'.replace(',', '{,}')


# E1: the seed network.
NAMES = {'tank-main': 'Tank', 'pipe-main': 'PipeA', 'valve-main': 'Valve', 'pipe-upper': 'PipeB', 'tap-main': 'Tap'}
LABELS = {'tank-main': 'Tank', 'pipe-main': 'Pipe A', 'valve-main': 'Valve', 'pipe-upper': 'Pipe B', 'tap-main': 'Tap'}
profile = rows('e1_profile.csv')
table('tableProfile', ['label', 'pressure', 'flow'],
      [[f"{{{LABELS[r['id']]}}}", num(r['pressure_psi']), num(r['flow'])] for r in profile])
for r in profile:
    macro('press' + NAMES[r['id']], num(r['pressure_psi'], 0))
    macro('flow' + NAMES[r['id']], num(r['flow'], 0))

onset = {(r['id'], r['status']): float(r['first_source_psi']) for r in rows('e1_onset.csv')}
bands = []
for cid in reversed(list(NAMES)):
    warn, fail = onset[(cid, 'warning')], onset[(cid, 'failed')]
    bands.append([f'{{{LABELS[cid]}}}', num(warn), num(fail - warn), num(LIMIT_PSI - fail)])
    macro('onsetWarn' + NAMES[cid], num(warn))
    macro('onsetFail' + NAMES[cid], num(fail))
table('tableBands', ['label', 'normal', 'warning', 'failed'], bands)
closed = {r['id']: r for r in rows('e1_closed_valve.csv')}
macro('closedPipeB', num(closed['pipe-upper']['pressure_psi'], 0))
macro('closedTap', num(closed['tap-main']['flow'], 0))

# E2: simulator scaling.
scaling = rows('e2_scaling.csv')
table('tableScale', ['n', 'median'], [[r['n'], f"{float(r['median_ms']):.4f}"] for r in scaling])
at = {int(r['n']): float(r['median_ms']) for r in scaling}
macro('scaleFive', num(at[5], 3))
macro('scaleHundred', num(at[100], 2))
macro('scaleOneK', num(at[1000], 1))
macro('scaleTwoK', num(at[2000], 0))
macro('scaleDoubling', num(at[2000] / at[1000], 1))
fit = {r['range']: float(r['log_log_slope']) for r in rows('e2_fit.csv')}
macro('scaleSlope', num(fit['n>=100'], 2))

# E3: round trip.
rtt = rows('e3_simulate_rtt.csv')[0]
macro('rttN', whole(rtt['n']))
macro('rttPfifty', num(rtt['p50_ms']))
macro('rttPninetyfive', num(rtt['p95_ms']))
macro('rttPninetynine', num(rtt['p99_ms']))
macro('simBytes', whole(rtt['response_bytes']))

# E4: fan-out. Error bars run from p50 up to p95.
fanout = [r for r in rows('e4_fanout.csv') if r['run'] == 'pooled']
SERIES = {'event': 'Event', 'event_get': 'Get', 'simulation': 'Sim'}
LETTERS = {1: 'A', 2: 'B', 5: 'C', 10: 'D', 25: 'E', 50: 'F'}
for mode, name in SERIES.items():
    points = [r for r in fanout if r['mode'] == mode]
    table('tableFan' + name, ['clients', 'p50', 'err'],
          [[r['clients'], num(r['p50_ms'], 3), num(float(r['p95_ms']) - float(r['p50_ms']), 3)] for r in points] or [['nan', 'nan', 'nan']])
    for r in points:
        letter = LETTERS[int(r['clients'])]
        macro(f'fan{name}Pfifty{letter}', num(r['p50_ms']))
        macro(f'fan{name}Pninetyfive{letter}', num(r['p95_ms']))
        macro(f'fan{name}Max{letter}', num(r['max_ms'], 0))
        macro(f'fan{name}Last{letter}', num(r['last_peer_p95_ms']))
    if points:
        macro(f'fan{name}Bytes', whole(points[-1]['event_bytes']))
macro('fanSamples', whole(sum(int(r['n']) for r in fanout)))
macro('fanDelivered', whole(sum(int(r['delivered']) for r in fanout)))
macro('fanTimeouts', sum(int(r['timeouts']) for r in fanout))

# E5: convergence.
lost = {r['arm']: r for r in rows('e5_lost_update.csv')}
macro('lostTrials', lost['concurrent_stale']['trials'])
for arm, name in (('concurrent_stale', 'Conc'), ('sequential_stale', 'Seq'), ('sequential_fresh', 'Fresh')):
    macro(f'lost{name}', lost[arm]['trials_with_loss'])
    macro(f'lost{name}Open', lost[arm]['open_edit_lost'])
    macro(f'lost{name}Pos', lost[arm]['position_edit_lost'])
back = rows('e5_reconnect.csv')[0]
macro('awaySent', back['events_sent_while_away'])
macro('awayReplayed', back['events_replayed_after_reconnect'])
macro('awayControl', back['control_events_received'])
macro('awayStale', back['trials_state_differs_without_refetch'])
macro('awayTrials', back['trials'])

# E6: socket churn.
if (results / 'e6_churn.csv').exists():
    churn = rows('e6_churn.csv')[0]
    macro('churnUpdates', whole(churn['updates']))
    macro('churnJoins', whole(churn['socket_joins']))
    macro('churnErrors', churn['http_5xx'])
    macro('churnSeconds', churn['duration_s'])

# E7: browser. Optional, because the experiment may be reported as not measured.
if (results / 'e7_bundle.csv').exists():
    bundle = rows('e7_bundle.csv')
    macro('bundleKB', whole(sum(int(r['bytes']) for r in bundle) / 1024))
    macro('bundleGzKB', whole(sum(int(r['gzip_bytes']) for r in bundle) / 1024))
if (results / 'e7_frames.csv').exists():
    frames = rows('e7_frames.csv')
    sizes = sorted({int(r['n']) for r in frames})
    renderer = frames[0]['renderer']
    macro('gpuName', 'an NVIDIA GeForce GTX 1650 Ti Mobile' if 'NVIDIA' in renderer else 'integrated Intel UHD graphics' if 'Intel' in renderer else renderer)
    by = {(int(r['n']), r['state']): r for r in frames}
    table('tableFrames', ['n', 'idle', 'sim', 'simlow'],
          [[n, num(by[(n, 'idle')]['mean_fps']), num(by[(n, 'simulating')]['mean_fps']), num(by[(n, 'simulating')]['low1pct_fps'])] for n in sizes])
    words = {5: 'Five', 25: 'TwentyFive', 50: 'Fifty', 100: 'Hundred', 200: 'TwoHundred'}
    for n in sizes:
        macro(f'fpsIdle{words[n]}', num(by[(n, 'idle')]['mean_fps'], 0))
        macro(f'fpsSim{words[n]}', num(by[(n, 'simulating')]['mean_fps'], 0))
        macro(f'fpsLow{words[n]}', num(by[(n, 'simulating')]['low1pct_fps'], 0))

else:
    table('tableFrames', ['n', 'idle', 'sim', 'simlow'], [['nan', 'nan', 'nan', 'nan']])
    macro('framesMissing', '1')

source = tex.read_text()
# Anything the text cites that has not been measured prints as a visible marker.
defined = {d for d in re.findall(r'\\newcommand\{\\(\w+)\}', '\n'.join(out))}
body = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END), '', source, flags=re.S)
cited = set(re.findall(r'\\((?:fan|fps|churn|bundle|gpu)[A-Za-z]+)', body))
for name in sorted(cited - defined):
    macro(name, r'\textbf{[pending]}')
block = '\n'.join(out)
pattern = re.compile(re.escape(BEGIN) + r'.*?' + re.escape(END), re.S)
if not pattern.search(source):
    raise SystemExit('generated-data markers not found in ' + str(tex))
tex.write_text(pattern.sub(lambda _: f'{BEGIN}\n{block}\n{END}', source))
print(f'{len(out)} definitions written to {tex}')
