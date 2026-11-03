import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Box,
  ChevronDown,
  CircleHelp,
  Cloud,
  CloudOff,
  Droplets,
  Gauge,
  Grid2X2,
  Layers3,
  MoreHorizontal,
  Move3D,
  Pause,
  Play,
  Plus,
  RotateCw,
  Settings2,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import NetworkScene from "../scene/NetworkScene";
import { catalog } from "../domain/catalog";
import { useStore } from "../state/stores";
import type { ComponentType } from "../domain/types";
import { listStoredAssets } from "../services/assetStorage";

const icons: Record<ComponentType, string> = {
  pipe: "━",
  "curved-pipe": "╰",
  valve: "◉",
  tap: "⌁",
  tank: "▤",
  custom: "◇",
};
export default function App() {
  const components = useStore((s) => s.components),
    selectedId = useStore((s) => s.selected),
    setSelected = useStore((s) => s.setSelected),
    placing = useStore((s) => s.placing),
    setPlacing = useStore((s) => s.setPlacing),
    pressure = useStore((s) => s.pressure),
    setPressure = useStore((s) => s.setPressure),
    run = useStore((s) => s.runSimulation),
    stop = useStore((s) => s.stopSimulation),
    running = useStore((s) => s.running),
    reset = useStore((s) => s.reset),
    diagnostic = useStore((s) => s.diagnostic),
    remove = useStore((s) => s.remove),
    rotate = useStore((s) => s.rotate),
    move = useStore((s) => s.move),
    setRotation3 = useStore((s) => s.setRotation3),
    setMaterial = useStore((s) => s.setMaterial),
    setFluid = useStore((s) => s.setFluid),
    setAgeDays = useStore((s) => s.setAgeDays),
    align = useStore((s) => s.align),
    customAssets = useStore((s) => s.customAssets),
    activeCustom = useStore((s) => s.activeCustom),
    addCustomAsset = useStore((s) => s.addCustomAsset),
    selectCustomAsset = useStore((s) => s.selectCustomAsset),
    setConnectionMode = useStore((s) => s.setConnectionMode),
    connectionMode = useStore((s) => s.connectionMode),
    toggleValve = useStore((s) => s.toggleValve),
    initialize = useStore((s) => s.initialize),
    apiStatus = useStore((s) => s.apiStatus),
    apiError = useStore((s) => s.apiError),
    pendingSaves = useStore((s) => s.pendingSaves),
    connectionCount = useStore((s) => s.connections.length);
  const [tab, setTab] = useState<"build" | "simulate" | "diagnose" | "repair">(
    "build",
  );
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [moveAxis, setMoveAxis] = useState<"free" | "x" | "y" | "z">("free");
  const [rotateAxis, setRotateAxis] = useState<"x" | "y" | "z">("z");
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customMaterial, setCustomMaterial] = useState("Steel");
  const [customPressure, setCustomPressure] = useState(100);
  const [customAgeDays, setCustomAgeDays] = useState(0);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const selected = components.find((c) => c.id === selectedId);
  const saveState = apiStatus === "error"
    ? { tone: "offline", label: "Offline · changes not saved" }
    : apiStatus === "connecting"
    ? { tone: "connecting", label: "Connecting…" }
    : pendingSaves > 0
    ? { tone: "saving", label: "Saving…" }
    : { tone: "saved", label: "All changes saved" };
  const turn = (direction: number) => {
    const index = rotateAxis === "x" ? 0 : rotateAxis === "y" ? 1 : 2;
    if (placing) {
      const r: [number, number, number] = [
        ...useStore.getState().placementRotation3,
      ];
      r[index] += direction * Math.PI / 2;
      useStore.getState().setPlacementRotation3(r);
    } else if (selected) {
      const r: [number, number, number] = selected.rotation3
        ? [...selected.rotation3]
        : [0, selected.rotation, 0];
      r[index] += direction * Math.PI / 2;
      setRotation3(selected.id, r);
    }
  };
  const groups = useMemo(
    () =>
      catalog.filter((c) =>
        c.type !== "custom" &&
        c.name.toLowerCase().includes(filter.toLowerCase())
      ),
    [filter],
  );
  useEffect(() => {
    void initialize();
    void listStoredAssets().then((assets) =>
      useStore.getState().setCustomAssets(assets)
    ).catch(() => {});
  }, [initialize]);
  const readModel = async (file: File) => {
    const format = file.name.split(".").pop()?.toLowerCase();
    if (format !== "glb" && format !== "obj" && format !== "fbx") {
      throw new Error("Choose a GLB, OBJ, or FBX model file.");
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read model file"));
      reader.onerror = () => reject(reader.error ?? new Error("Could not read model file"));
      reader.readAsDataURL(file);
    });
    return { format, dataUrl, fileName: file.name };
  };
  const launchSimulation = async () => {
    if (running) {
      stop();
      setNotice("Simulation stopped");
      setTimeout(() => setNotice(""), 1600);
      return;
    }
    await run();
    if (useStore.getState().running) {
      setTab("diagnose");
      setNotice("Simulation started");
      setTimeout(() => setNotice(""), 1600);
    } else {
      setNotice("Simulation could not reach the API");
      setTimeout(() => setNotice(""), 2200);
    }
  };
  const repair = () => {
    if (!diagnostic.rootCause) return;
    remove(diagnostic.rootCause.id);
    setPlacing(diagnostic.rootCause.type);
    setTab("repair");
  };
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Droplets size={19} />
          </div>
          <div>
            <strong>
              Pipe<span>Lab</span>
            </strong>
            <small>HYDRAULIC SYSTEMS STUDIO</small>
          </div>
        </div>
        <div className="project-name">
          <span className={`live-dot ${saveState.tone}`} />{" "}
          <span>UNTITLED SYSTEM</span>
          <ChevronDown size={13} />
          <span className={`save-state ${saveState.tone}`}>
            {apiStatus === "error" ? <CloudOff size={14} /> : <Cloud size={14} />}
            {" "}
            {saveState.label}
          </span>
        </div>
        <div className="top-actions">
          <button className="icon-button" title="Help">
            <CircleHelp size={17} />
          </button>
          <button className="icon-button" title="Settings">
            <Settings2 size={17} />
          </button>
          <span className="divider" />
          <button className="avatar">AM</button>
        </div>
      </header>
      <div className="workspace">
        <aside className="tool-rail panel">
          <span className="eyebrow">WORKFLOW</span>
          <div className="mode-tabs">
            <button className={tab === "build" ? "active" : ""} onClick={() => setTab("build")}><Grid2X2 size={16} /> Build</button>
            <button className={tab === "simulate" ? "active" : ""} onClick={() => setTab("simulate")}><Activity size={16} /> Simulate</button>
            <button className={tab === "diagnose" ? "active" : ""} onClick={() => setTab("diagnose")}><AlertTriangle size={16} /> Diagnose{diagnostic.rootCause && <i className="tab-alert" />}</button>
            <button className={tab === "repair" ? "active" : ""} onClick={() => setTab("repair")}><Wrench size={16} /> Repair</button>
          </div>
          <div className="rail-pressure">
            <label><Gauge size={15} /> Source pressure <b>{pressure} PSI</b></label>
            <input aria-label="Source pressure PSI" type="range" min="0" max="200" step="5" value={pressure} onChange={(e) => setPressure(Number(e.target.value))} />
            <div className="rail-pressure-stepper"><button onClick={() => setPressure(Math.max(0, pressure - 5))}>−</button><input aria-label="Source pressure value" type="number" min="0" max="200" value={pressure} onChange={(e) => setPressure(Number(e.target.value))} /><button onClick={() => setPressure(Math.min(200, pressure + 5))}>+</button></div>
          </div>
          <div className="rail-actions">
            <button className="reset-button" title="Restore the original starter components" onClick={reset}>RESET INITIAL</button>
            <button className="run-button" onClick={launchSimulation}>{running ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{running ? "STOP SIMULATION" : "START SIMULATION"}</button>
          </div>
        </aside>
        <section className="viewport">
          <div className="viewport-toolbar">
            <div className="breadcrumb">
              Workspace <span>/</span> Main network{" "}
              <span className="canvas-label">3D VIEW</span>
            </div>
            <div className="view-tools">
              <span className={`connection-status ${apiStatus}`}>
                <i /> {apiStatus === "connected"
                  ? "API CONNECTED"
                  : apiStatus === "connecting"
                  ? "CONNECTING"
                  : "API OFFLINE"}
              </span>
              <button
                className="view-btn"
                title="Clear selection"
                aria-label="Clear selection"
                onClick={() => setSelected(null)}
              >
                <Move3D size={14} /> Select
              </button>
              <div className="axis-tools">
                {(["free", "x", "y", "z"] as const).map((axis) => (
                  <button
                    key={axis}
                    className={moveAxis === axis ? "selected" : ""}
                    onClick={() => {
                      setMoveAxis(axis);
                      document.body.dataset.moveAxis = axis;
                    }}
                  >
                    {axis.toUpperCase()}
                  </button>
                ))}
              </div>
              <div
                className="rotate-tools"
                title="Choose an axis, then turn by 90 degrees"
              >
                <span>ROTATE</span>
                {(["x", "y", "z"] as const).map((axis) => (
                  <button
                    key={axis}
                    className={rotateAxis === axis ? "selected" : ""}
                    aria-label={`Rotate around ${axis.toUpperCase()} axis`}
                    onClick={() => {
                      setRotateAxis(axis);
                      document.body.dataset.rotateAxis = axis;
                    }}
                  >
                    {axis.toUpperCase()}
                  </button>
                ))}
                <button
                  className="turn-button"
                  aria-label="Rotate 90 degrees counterclockwise"
                  disabled={!placing && !selected}
                  onClick={() => turn(-1)}
                >
                  −90°
                </button>
                <button
                  className="turn-button"
                  aria-label="Rotate 90 degrees clockwise"
                  disabled={!placing && !selected}
                  onClick={() => turn(1)}
                >
                  <RotateCw size={12} /> +90°
                </button>
              </div>
              <button
                className="view-btn"
                title="Snap each connected pair together"
                onClick={() => {
                  align();
                  setNotice("Connected ports aligned");
                  setTimeout(() => setNotice(""), 1600);
                }}
              >
                <Layers3 size={14} /> Align
              </button>
              <button
                className="view-btn"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("pipelab:frame-scene"))}
                title="Frame all components"
              >
                <Grid2X2 size={14} />
              </button>
            </div>
          </div>
          <div className="scene-wrap">
            <NetworkScene />
            <div className="scene-hud">
              <div className={`hud-pill ${running ? "running" : ""}`}>
                <span className="live-dot" />{" "}
                {running ? "SIMULATION RUNNING" : "EDITING"}
              </div>
              <div className="hud-axis">
                <span>Y</span>
                <i />
                <b>X</b>
                <em>Z</em>
              </div>
              <div className="nav-help">
                Drag empty space · orbit &nbsp;|&nbsp; Wheel · zoom
                &nbsp;|&nbsp; Shift + drag · pan
              </div>
            </div>
            {placing && (
              <div className="placement-tip">
                <span className="tip-key">CLICK</span> place component{" "}
                <span className="tip-sep" />{" "}
                <span className="tip-key">Q / E</span> rotate{" "}
                <span className="tip-sep" />{" "}
                <span className="tip-key">ESC</span> cancel
              </div>
            )}
            <div className="view-cube">
              <div className="cube-top">TOP</div>
              <div className="cube-face">FRONT</div>
              <span className="cube-compass">N</span>
            </div>
          </div>
          {apiError && (
            <div className="api-error" role="alert">
              <CloudOff size={15} />
              <span>{apiError}</span>
              <button onClick={() => void initialize()}>Retry</button>
            </div>
          )}
          <div className="viewport-status">
            <span>
              <i className="status-dot green" /> {components.length} components
            </span>
            <span>
              <i className="status-dot teal" />{" "}
              {connectionCount} connections
            </span>
            <span>
              GRID <b>0.5 m</b>
            </span>
            <span className="status-right">PERSPECTIVE · SCROLL TO ZOOM</span>
          </div>
          <div className="timeline">
            <span className="timeline-title">SYSTEM PRESSURE</span>
            <div className="timeline-line">
              <span style={{ left: "17%" }} />
              <span style={{ left: "52%" }} />
              <span style={{ left: "89%" }} />
            </div>
            <span className="timeline-time">
              00:00:00 {running && <i>● LIVE</i>}
            </span>
          </div>
        </section>
        <aside className="properties panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">INSPECTOR</span>
              <h2>Properties</h2>
            </div>
            <button className="subtle-icon">
              <MoreHorizontal size={18} />
            </button>
          </div>
          {selected
            ? (
              <>
                <div className="selected-object">
                  <div className={`object-preview ${selected.type}`}>
                    {icons[selected.type]}
                  </div>
                  <div>
                    <h3>{selected.name}</h3>
                    <span className="component-id">
                      COMPONENT · {selected.id.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                </div>
                {selected.customAssetId && customAssets.find((asset) => asset.id === selected.customAssetId)?.description && (
                  <p className="inspector-description">{customAssets.find((asset) => asset.id === selected.customAssetId)?.description}</p>
                )}
                <div className="property-section">
                  <div className="section-label">
                    LIVE STATUS{" "}
                    <span className={`state-chip ${selected.status}`}>
                      {selected.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="metric-row">
                    <span>Pressure</span>
                    <b>
                      {selected.pressure.toFixed(1)} <small>PSI</small>
                    </b>
                  </div>
                  <div className="metric-row">
                    <span>Flow rate</span>
                    <b>
                      {selected.flow.toFixed(1)} <small>L/MIN</small>
                    </b>
                  </div>
                  <div className="metric-row">
                    <span>Health</span>
                    <b>
                      {Math.round(selected.health ?? 100)} <small>%</small>
                    </b>
                  </div>
                  <div className="metric-row">
                    <span>Estimated service life</span>
                    <b>
                      {selected.lifeDays === undefined
                        ? "Run simulation"
                        : `${selected.lifeDays} days`}
                    </b>
                  </div>
                </div>
                <div className="property-section">
                  <div className="section-label">CONFIGURATION</div>
                  <label className="field-label">Flowing fluid</label>
                  <select
                    className="field-value material-select"
                    aria-label="Flowing fluid"
                    value={selected.fluid ?? "Fresh water"}
                    onChange={(e) => setFluid(selected.id, e.target.value)}
                  >
                    <option>Fresh water</option>
                    <option>Hard water</option>
                    <option>Salt water</option>
                    <option>Waste water</option>
                  </select>
                  <label className="field-label">Service age · DAYS</label>
                  <input
                    className="field-value number-field"
                    aria-label="Service age days"
                    type="number"
                    min="0"
                    value={selected.ageDays ?? 0}
                    onChange={(e) =>
                      setAgeDays(selected.id, Number(e.target.value))}
                  />
                  <label className="field-label">Material</label>
                  <select
                    className="field-value material-select"
                    aria-label="Material"
                    value={selected.material}
                    onChange={(e) => setMaterial(selected.id, e.target.value)}
                  >
                    <option>PVC</option>
                    <option>Glass</option>
                    <option>Brass</option>
                    <option>Steel</option>
                    <option>Chrome</option>
                  </select>
                  <div className="field-pair">
                    <div>
                      <label className="field-label">Diameter</label>
                      <div className="field-value">
                        {selected.diameter * 1000} <small>MM</small>
                      </div>
                    </div>
                    <div>
                      <label className="field-label">Pressure rating</label>
                      <div className="field-value">
                        {selected.maxPressure} <small>PSI</small>
                      </div>
                    </div>
                  </div>
                  <label className="field-label space-top">
                    Position · METRES
                  </label>
                  <div className="xyz-controls">
                    {(["X", "Y", "Z"] as const).map((axis, i) => (
                      <label key={axis}>
                        <span className={`axis axis-${axis.toLowerCase()}`}>
                          {axis}
                        </span>
                        <input
                          aria-label={`Position ${axis}`}
                          type="number"
                          step="0.5"
                          value={selected.position[i]}
                          onChange={(e) => {
                            const p: [number, number, number] = [
                              ...selected.position,
                            ];
                            p[i] = Number(e.target.value);
                            move(selected.id, p);
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <label className="field-label space-top">
                    Rotation · DEGREES
                  </label>
                  <div className="xyz-controls rotation-controls">
                    {(["X", "Y", "Z"] as const).map((axis, i) => (
                      <label key={axis}>
                        <span className={`axis axis-${axis.toLowerCase()}`}>
                          {axis}
                        </span>
                        <input
                          aria-label={`Rotation ${axis}`}
                          type="number"
                          step="15"
                          value={Math.round(
                            (selected.rotation3?.[i] ??
                              (i === 1 ? selected.rotation : 0)) *
                              180 / Math.PI,
                          )}
                          onChange={(e) => {
                            const r: [number, number, number] =
                              selected.rotation3
                                ? [...selected.rotation3]
                                : [0, selected.rotation, 0];
                            r[i] = Number(e.target.value) * Math.PI / 180;
                            setRotation3(selected.id, r);
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    className={`connect-button ${
                      connectionMode ? "connecting" : ""
                    }`}
                    onClick={() => setConnectionMode(!connectionMode)}
                  >
                    {connectionMode
                      ? "Click another part to connect · drag pipe to disconnect"
                      : "Connect selected part · double-click a pipe to disconnect"}
                  </button>
                </div>
                <div className="property-section ports-section">
                  <div className="section-label">
                    CONNECTION PORTS <span>{selected.ports.length} PORTS</span>
                  </div>
                  {selected.ports.map((p) => (
                    <div className="port-row" key={p.id}>
                      <span className="port-light" />
                      <b>{p.id}</b>
                      <span>{p.direction}</span>
                      <small>DN {Math.round(p.diameter * 100)}</small>
                    </div>
                  ))}
                </div>
                {(selected.type === "valve" || selected.type === "tap") && (
                  <button
                    className={`valve-button ${selected.open ? "" : "closed"}`}
                    onClick={() => toggleValve(selected.id)}
                  >
                    <Zap size={14} />
                    {selected.type === "tap"
                      ? (selected.open
                        ? "Outlet open · flowing"
                        : "Outlet closed")
                      : (selected.open ? "Valve open · 100%" : "Valve closed")}
                  </button>
                )}
                <div className="property-footer">
                  <button
                    className="delete-button"
                    onClick={() => remove(selected.id)}
                  >
                    <Trash2 size={14} /> Delete component
                  </button>
                </div>
              </>
            )
            : (
              <div className="empty-inspector">
                <div className="empty-icon">
                  <Move3D size={20} />
                </div>
                <strong>Select a component</strong>
                <p>
                  Select a part, drag it to move, or use X/Y/Z controls to
                  position it.
                </p>
              </div>
            )}
        </aside>
      </div>
      <section className="inventory-dock">
        <div className="dock-heading">
          <div><span className="eyebrow">COMPONENT LIBRARY</span><strong>Inventory <small>{catalog.filter((item) => item.type !== "custom").length + customAssets.length}</small></strong></div>
          <label className="dock-search"><input aria-label="Search inventory" placeholder="Filter slots" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
          <button className="create-object-button" onClick={() => { setCustomName(""); setCustomDescription(""); setCustomAgeDays(0); setCustomFile(null); setCustomOpen(true); }}><Plus size={14} /> New object</button>
        </div>
        <div className="inventory-slots">
          {groups.map((c, i) => <button key={c.type} className={`hotbar-slot ${placing === c.type ? "active" : ""}`} onClick={() => setPlacing(c.type)} title={`${c.name} — ${String(c.properties.description ?? "")}`}><b>{i + 1}</b><span className={`slot-model ${c.type}`}>{icons[c.type]}</span><small>{c.name}</small></button>)}
          {customAssets.filter((asset) => asset.name.toLowerCase().includes(filter.toLowerCase())).map((asset, i) => <button key={asset.id} className={`hotbar-slot custom-slot ${placing === "custom" && activeCustom?.id === asset.id ? "active" : ""}`} onClick={() => selectCustomAsset(asset)} title={`${asset.name} — ${asset.description}`}><b>{groups.length + i + 1}</b><span className="slot-model"><Box size={19} /></span><small>{asset.name}</small></button>)}
          <span className="dock-hint">Select a slot, then click the scene to place</span>
        </div>
      </section>
      <section className="control-bar">
        <div className="mode-tabs">
          <button
            className={tab === "build" ? "active" : ""}
            onClick={() => setTab("build")}
          >
            <Grid2X2 size={15} /> BUILD
          </button>
          <button
            className={tab === "simulate" ? "active" : ""}
            onClick={() => setTab("simulate")}
          >
            <Activity size={15} /> SIMULATE
          </button>
          <button
            className={tab === "diagnose" ? "active" : ""}
            onClick={() => setTab("diagnose")}
          >
            <AlertTriangle size={15} />{" "}
            DIAGNOSE{diagnostic.rootCause && <i className="tab-alert" />}
          </button>
          <button
            className={tab === "repair" ? "active" : ""}
            onClick={() => setTab("repair")}
          >
            <Wrench size={15} /> REPAIR
          </button>
        </div>
        <div className="pressure-control">
          <Gauge size={16} />
          <span>SOURCE PRESSURE</span>
          <button
            className="stepper"
            onClick={() => setPressure(Math.max(0, pressure - 5))}
          >
            −
          </button>
          <input
            aria-label="Source pressure PSI"
            type="number"
            min="0"
            max="200"
            value={pressure}
            onChange={(e) => setPressure(Number(e.target.value))}
          />
          <b>PSI</b>
          <button
            className="stepper"
            onClick={() => setPressure(Math.min(200, pressure + 5))}
          >
            +
          </button>
          <input
            className="pressure-slider"
            type="range"
            min="0"
            max="200"
            step="5"
            value={pressure}
            onChange={(e) => setPressure(Number(e.target.value))}
          />
        </div>
        <div className="run-actions">
          <button
            className="reset-button"
            title="Restore the original starter components"
            onClick={reset}
          >
            RESET INITIAL
          </button>
          <button className="run-button" onClick={launchSimulation}>
            {running
              ? <Pause size={14} fill="currentColor" />
              : <Play size={14} fill="currentColor" />}{" "}
            {running ? "STOP SIMULATION" : "START SIMULATION"}
          </button>
        </div>
      </section>
      {tab !== "build" && (
        <section className="bottom-drawer">
          <div className="drawer-head">
            <div>
              <span className="eyebrow">
                {tab === "diagnose"
                  ? "SYSTEM ANALYSIS"
                  : tab === "repair"
                  ? "REPAIR WORKFLOW"
                  : "SIMULATION CONTROLS"}
              </span>
              <h2>
                {tab === "diagnose"
                  ? "Diagnostics"
                  : tab === "repair"
                  ? "Component repair"
                  : "Pressure simulation"}
              </h2>
            </div>
            <button className="subtle-icon" onClick={() => setTab("build")}>
              ×
            </button>
          </div>
          {tab === "diagnose"
            ? (
              <div
                className={`diagnostic-card ${
                  diagnostic.rootCause ? "failed" : "stable"
                }`}
              >
                <div className="diagnostic-icon">
                  {diagnostic.rootCause
                    ? <AlertTriangle size={18} />
                    : <Activity size={18} />}
                </div>
                <div className="diagnostic-copy">
                  <strong>
                    {diagnostic.rootCause
                      ? "ROOT CAUSE · " + diagnostic.rootCause.name
                      : "SYSTEM STABLE"}
                  </strong>
                  <p>{diagnostic.message}</p>
                  <small>{diagnostic.recommendation}</small>
                </div>
                {diagnostic.rootCause && (
                  <button className="repair-cta" onClick={repair}>
                    <Wrench size={14} /> Replace component
                  </button>
                )}
              </div>
            )
            : tab === "repair"
            ? (
              <div className="repair-message">
                <Wrench size={17} />
                <span>
                  {placing
                    ? `Replacement selected: ${
                      catalog.find((c) => c.type === placing)?.name
                    }. Click the grid to place and reconnect it.`
                    : "Select a failed component in diagnostics to start a repair."}
                </span>
              </div>
            )
            : (
              <div className="sim-message">
                <span className="live-dot" /> Deterministic network simulation ·
                {" "}
                {components.length} domain components ·{" "}
                {connectionCount} connections
              </div>
            )}
        </section>
      )}
      {customOpen && (
        <div className="custom-modal">
          <form
            className="custom-dialog"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!customName.trim()) {
                setNotice("Give your object a name first.");
                return;
              }
              try {
                const model = customFile ? await readModel(customFile) : undefined;
                const asset = {
                name: customName.trim(),
                material: customMaterial,
                maxPressure: customPressure,
                ageDays: customAgeDays,
                description: customDescription.trim() || "User-defined inline object",
                ...(customFile && model ? { fileName: model.fileName, format: model.format as "glb" | "obj" | "fbx", dataUrl: model.dataUrl } : {}),
              };
                await addCustomAsset(asset);
                const savedAssets = useStore.getState().customAssets;
                const created = savedAssets[savedAssets.length - 1];
                if (created) selectCustomAsset(created);
                setCustomOpen(false);
                setNotice(
                  "Object saved to your inventory — click the scene to place it",
                );
                setTimeout(() => setNotice(""), 2600);
              } catch (error) {
                setNotice(error instanceof Error
                  ? error.message
                  : "Could not save this object in the browser asset library.");
              }
            }}
          >
            <div>
              <span className="eyebrow">CUSTOM OBJECT</span>
                  <h2>Create a placeable object</h2>
            </div>
            <label>
              Name<input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                autoFocus
              />
            </label>
            <label>
              Description<textarea
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="What does this part do?"
                rows={3}
              />
            </label>
            <label>
              3D model (optional)<input
                type="file"
                accept=".glb,.obj,.fbx,model/gltf-binary,application/octet-stream,text/plain"
                onChange={(e) => setCustomFile(e.currentTarget.files?.[0] ?? null)}
              />
              <small className="model-file-hint">GLB, OBJ, or FBX. Leave empty to use a simple placeholder shape.</small>
            </label>
            <div className="custom-form-pair">
            <label>
              Service age · DAYS<input
                type="number"
                min="0"
                value={customAgeDays}
                onChange={(e) => setCustomAgeDays(Number(e.target.value))}
              />
            </label>
            <label>
              Pressure rating · PSI<input
                type="number"
                min="1"
                value={customPressure}
                onChange={(e) => setCustomPressure(Number(e.target.value))}
              />
            </label>
            </div>
            <label>
              Material<select
                value={customMaterial}
                onChange={(e) => setCustomMaterial(e.target.value)}
              >
                <option>Steel</option>
                <option>PVC</option>
                <option>Brass</option>
              </select>
            </label>
            <div className="health-preview"><Activity size={14} /> Initial health <b>100%</b><span>Updates as the system simulates wear.</span></div>
            <div className="modal-actions">
              <button type="button" onClick={() => setCustomOpen(false)}>
                Cancel
              </button>
              <button type="submit">Save object</button>
            </div>
          </form>
        </div>
      )}
      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
