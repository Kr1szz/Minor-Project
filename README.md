# PipeLab — Hydraulic Systems Studio

PipeLab is a browser based plumbing network editor and digital twin prototype. It separates the scene renderer from the domain model and hydraulic graph so alternate clients (including AR/MR viewers) can consume the same project state later.

## Architecture

- `src/domain` contains component definitions with explicit ports, shared types and placement snapping.
- `src/scene` renders domain entities with React Three Fiber; `models.tsx` holds the part models, built around each part's ports. The scene is a view of component IDs and connections, not the simulation source of truth.
- `src/state` holds scene, selection, inventory and simulation state in a Zustand store. On startup it hydrates or seeds a project through FastAPI, persists mutations, and requests every simulation result from the API. The browser does not author pressure or failure outcomes.
- `backend/app` provides FastAPI schemas, SQLAlchemy domain persistence, simulation service and a versioned project WebSocket event channel. PostgreSQL is the configured persistent store; SQLite is a development fallback when running the API directly.
- `docker-compose.yml` runs PostgreSQL, Redis and the API. Redis is provisioned for future pub/sub fanout; single-process WebSocket broadcast is currently used.

## Run locally

Requirements: Node.js 20+, and either [uv](https://docs.astral.sh/uv/) or Python 3.12/3.13. Docker Compose is optional.

```bash
./dev.sh
```

This installs dependencies on the first run, then starts the API on `http://localhost:8000` (SQLite in `backend/pipelab.db`) and the editor on `http://localhost:5173`. Ctrl+C stops both. Use `./dev.sh --docker` to run the API with PostgreSQL and Redis through Docker Compose instead, and `API_PORT` / `WEB_PORT` to change ports.

API docs are at `http://localhost:8000/docs`; health is `GET /health`. With `--docker`, PostgreSQL is exposed on host port `5433` to avoid conflicting with an existing local PostgreSQL service.

To run the pieces separately: `npm install && npm run dev` for the frontend, and from `backend/`, `uvicorn app.main:app --reload` inside a Python 3.12 virtual environment with `requirements.txt` installed.

## Tests

```bash
npm test                                   # Vitest: API mapping and placement
cd backend && .venv/bin/pytest             # pytest: simulator and API
```

`./dev.sh` creates `backend/.venv`; install the test tools into it once with `uv pip install --python backend/.venv/bin/python -r backend/requirements-dev.txt` (or `backend/.venv/bin/pip install -r backend/requirements-dev.txt`).

## First vertical slice

The starter network is a pressure tank, two PVC pipes, a ball valve and an outlet tap joined through named ports. Pick a part from the inventory (or press 1–6) and click the scene to place it; it snaps onto the nearest free port. Drag parts to move them, Q/E rotate in quarter turns, Delete removes the selection and Esc cancels; **Shortcuts** in the top bar lists the rest. The inspector opens/closes valves and taps, edits material, fluid and age, and lists each part's connections with a disconnect button. **Run simulation** shows water flow, leaks and bursts in the scene; Simulate shows the pressure profile and Diagnose lists every issue, with Replace for the root cause.

The simulator subtracts each upstream part's fixed `pressure_loss` from the source pressure along the least-loss path, treats a joint as connected only while its ports meet (within 0.2 m), and reports open pressurized ports as leaks. It is not CFD, water hammer, or a validated engineering design tool. Replace `backend/app/simulation.py` behind the existing graph boundary to introduce a calibrated solver; the editor only renders the API's results.

## API and event architecture

Projects persist actual components, port definitions, connections, pressure inputs, simulation results, failures, and events. Core endpoints: `POST/GET /projects`, `GET/PUT /projects/{id}`, component create/update/delete routes, `POST /projects/{id}/simulate`, `/reset`, diagnostics, and asset create/list/read routes. A client joins `/ws/projects/{id}`. Events use `{version, type, project_id, payload}`; the API broadcasts authoritative mutation and simulation events to connected clients. Before multi-worker deployment, move broadcast fanout to Redis pub/sub and add authentication, event sequencing and reconnect snapshots.

## Adding a component

Add a typed `ComponentType`, a catalog `ComponentDefinition` containing ports and engineering properties, and a renderer branch in `NetworkScene`. Add defaults in the domain/store layer and a backend definition record as needed. Ports carry local position, direction and diameter. Connections refer to component and port IDs; visual proximity alone does not define hydraulic connectivity.

## Custom assets

The asset metadata API stores a model reference separately from component simulation definitions. The prototype does not yet accept binary uploads or render imported assets. A production importer should validate GLB/glTF (preferred) and OBJ files, store them in object storage, and require users to define ports, pressure rating, resistance, material and dimensions before an asset can participate in simulation. Model metadata does not implicitly make geometry simulation-ready.

## AR/MR path

Browser, HoloLens and XREAL clients should join the same project API/WebSocket and render stable domain component IDs in their own coordinate systems. Persist domain entities and connections rather than Three.js serialization; add explicit spatial anchors/coordinate transforms for device alignment when WebXR/device clients are introduced.
