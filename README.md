# PipeLab — Hydraulic Systems Studio

PipeLab is a browser based plumbing network editor and digital twin prototype. It separates the scene renderer from the domain model and hydraulic graph so alternate clients (including AR/MR viewers) can consume the same project state later.

## Architecture

- `src/domain` contains component definitions, explicit ports, graph traversal and a deterministic pressure/flow simulation. It has no Three.js dependency.
- `src/scene` renders domain entities with React Three Fiber. The scene is a view of component IDs and connections, not the simulation source of truth.
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

## First vertical slice

The initial graph has a pressure tank, PVC pipe, ball valve and outlet tap joined through named ports. Select inventory to enter placement mode; click the viewport grid to place. Grid placement snaps to half-unit increments and snaps near the current run. Q/E or R rotates in quarter turns, Escape cancels, Delete removes a selected part, and arrow keys nudge selection. Select the valve to toggle it. Change source PSI and press **Simulate**. Diagnostics name the first overloaded component as root cause and list downstream taps separately. Replace component opens placement for that part type.

Current milestone uses a simplified deterministic pressure loss per component and flow resistance. It is not CFD, water hammer, or a validated engineering design tool. Replace `backend/app/simulation.py` behind the existing graph boundary to introduce a calibrated solver. `src/domain/simulation.ts` remains a pure reference implementation for unit-level domain work; the running editor uses the API response.

## API and event architecture

Projects persist actual components, port definitions, connections, pressure inputs, simulation results, failures, and events. Core endpoints: `POST/GET /projects`, `GET/PUT /projects/{id}`, component create/update/delete routes, `POST /projects/{id}/simulate`, `/reset`, diagnostics, and asset create/list/read routes. A client joins `/ws/projects/{id}`. Events use `{version, type, project_id, payload}`; the API broadcasts authoritative mutation and simulation events to connected clients. Before multi-worker deployment, move broadcast fanout to Redis pub/sub and add authentication, event sequencing and reconnect snapshots.

## Adding a component

Add a typed `ComponentType`, a catalog `ComponentDefinition` containing ports and engineering properties, and a renderer branch in `NetworkScene`. Add defaults in the domain/store layer and a backend definition record as needed. Ports carry local position, direction and diameter. Connections refer to component and port IDs; visual proximity alone does not define hydraulic connectivity.

## Custom assets

The asset metadata API stores a model reference separately from component simulation definitions. The prototype does not yet accept binary uploads or render imported assets. A production importer should validate GLB/glTF (preferred) and OBJ files, store them in object storage, and require users to define ports, pressure rating, resistance, material and dimensions before an asset can participate in simulation. Model metadata does not implicitly make geometry simulation-ready.

## AR/MR path

Browser, HoloLens and XREAL clients should join the same project API/WebSocket and render stable domain component IDs in their own coordinate systems. Persist domain entities and connections rather than Three.js serialization; add explicit spatial anchors/coordinate transforms for device alignment when WebXR/device clients are introduced.
