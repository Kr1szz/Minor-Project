"""E7: frame times of the unmodified production build in a real browser window.

Drives Chromium over the DevTools protocol using only websockets and httpx, and
records requestAnimationFrame intervals from outside the app. The page must be
served on PAGE and the API must hold exactly one project.

Usage: python bench_render.py <results-dir>
"""
import asyncio
import csv
import itertools
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx
import websockets

sys.path.insert(0, str(Path(__file__).parent))
from seed_network import chain  # noqa: E402

API = 'http://127.0.0.1:8000'
PAGE = 'http://127.0.0.1:4173/'
PORT = 9333
SIZES = [5, 25, 50, 100, 200]
SETTLE_S = 6
MEASURE_MS = 15000
ROW = 8

RECORDER = """new Promise(resolve => {
  const times = [];
  const start = performance.now();
  const tick = t => { times.push(t); performance.now() - start < %d ? requestAnimationFrame(tick) : resolve(JSON.stringify(times)); };
  requestAnimationFrame(tick);
})""" % MEASURE_MS

RENDERER = """(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2', {powerPreference: 'low-power'});
  const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()"""

CLICK_RUN = "(() => { const b = document.querySelector('.run-button'); if (b) b.click(); return Boolean(b); })()"


def lay_out(parts):
    """Rows of end-to-end pipes in view of the default camera, so ports really align."""
    for index, part in enumerate(parts):
        row, column = divmod(index, ROW)
        part['position'] = [-7 + 2 * column, 1.0, 5 - 1.2 * row]
    tank = parts[0]
    tank['position'] = [parts[1]['position'][0] - 2 - .59 + 1, .75, 5]
    parts[-1]['position'][0] -= .5
    return parts


async def seed(http, project_id, size):
    (await http.post(f'/projects/{project_id}/reset')).raise_for_status()
    parts, edges = chain(size)
    for part in lay_out(parts):
        (await http.post(f'/projects/{project_id}/components', json=part)).raise_for_status()
    for edge in edges:
        (await http.post(f'/projects/{project_id}/connections', json=edge)).raise_for_status()


class Page:
    def __init__(self, socket):
        self.socket, self.ids = socket, itertools.count(1)

    async def call(self, method, **params):
        message_id = next(self.ids)
        await self.socket.send(json.dumps({'id': message_id, 'method': method, 'params': params}))
        while True:
            reply = json.loads(await self.socket.recv())
            if reply.get('id') == message_id:
                return reply

    async def evaluate(self, expression):
        reply = await self.call('Runtime.evaluate', expression=expression, awaitPromise=True, returnByValue=True)
        return reply['result']['result'].get('value')


def summary(times):
    intervals = sorted(b - a for a, b in zip(times, times[1:]))
    count = len(intervals)
    low = intervals[-max(1, count // 100):]
    return {'frames': count, 'mean_fps': 1000 * count / sum(intervals), 'median_ms': intervals[count // 2],
            'p95_ms': intervals[int(.95 * (count - 1))], 'p99_ms': intervals[int(.99 * (count - 1))],
            'low1pct_fps': 1000 * len(low) / sum(low)}


async def main():
    results = Path(sys.argv[1])
    rows = []
    async with httpx.AsyncClient(base_url=API, timeout=60) as http:
        projects = (await http.get('/projects')).json()
        project_id = projects[0]['id'] if projects else (await http.post('/projects', json={'name': 'render'})).json()['id']
        with tempfile.TemporaryDirectory() as profile:
            browser = subprocess.Popen(['chromium', f'--remote-debugging-port={PORT}', f'--user-data-dir={profile}',
                                        '--no-first-run', '--no-default-browser-check', '--disable-extensions',
                                        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
                                        '--disable-backgrounding-occluded-windows', '--window-size=1280,800', 'about:blank'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(40):
                    try:
                        targets = (await http.get(f'http://127.0.0.1:{PORT}/json')).json()
                        break
                    except httpx.TransportError:
                        await asyncio.sleep(.25)
                target = next(t for t in targets if t['type'] == 'page')
                async with websockets.connect(target['webSocketDebuggerUrl'], max_size=None, ping_interval=None) as socket:
                    page = Page(socket)
                    await page.call('Page.enable')
                    await page.call('Runtime.enable')
                    renderer = None
                    for size in SIZES:
                        await seed(http, project_id, size)
                        await page.call('Page.navigate', url=PAGE)
                        await asyncio.sleep(SETTLE_S)
                        renderer = renderer or await page.evaluate(RENDERER)
                        for state in ('idle', 'simulating'):
                            if state == 'simulating':
                                print('start clicked:', await page.evaluate(CLICK_RUN), flush=True)
                                await asyncio.sleep(2)
                            times = json.loads(await page.evaluate(RECORDER))
                            row = {'n': size, 'state': state, 'renderer': renderer, **summary(times)}
                            rows.append(row)
                            print(row, flush=True)
            finally:
                browser.terminate()
                browser.wait(timeout=15)
    with open(results / 'e7_frames.csv', 'w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


asyncio.run(main())
