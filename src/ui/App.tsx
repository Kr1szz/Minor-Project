import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CircleHelp,
  Cloud,
  CloudOff,
  Grid2X2,
  Layers3,
  Maximize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Undo2,
  Wrench,
} from "lucide-react";
import NetworkScene from "../scene/NetworkScene";
import { catalog } from "../domain/catalog";
import type { ComponentEntity, CustomAsset, Vec3 } from "../domain/types";
import { useStore } from "../state/stores";
import { listStoredAssets } from "../services/assetStorage";
import { Inspector } from "./Inspector";
import { CustomObjectDialog, HelpDialog } from "./Dialogs";
import { PartIcon } from "./PartIcon";

type Tab = "build" | "simulate" | "diagnose" | "repair";
const tabs: { id: Tab; label: string; icon: typeof Grid2X2 }[] = [
  { id: "build", label: "Build", icon: Grid2X2 },
  { id: "simulate", label: "Simulate", icon: Activity },
  { id: "diagnose", label: "Diagnose", icon: AlertTriangle },
  { id: "repair", label: "Repair", icon: Wrench },
];
const parts = catalog.filter((c) => c.type !== "custom");

function useNotice() {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2400);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

function Segmented<T extends string>(
  { label, options, value, onChange }: {
    label: string;
    options: readonly T[];
    value: T;
    onChange: (value: T) => void;
  },
) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      <span className="segmented-label">{label}</span>
      {options.map((option) => (
        <button
          key={option}
          role="radio"
          aria-checked={value === option}
          className={`axis-${option}`}
          onClick={() => onChange(option)}
        >
          {option === "free" ? "Free" : option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function PressureProfile() {
  const components = useStore((s) => s.components);
  const pressure = useStore((s) => s.pressure);
  const setSelected = useStore((s) => s.setSelected);
  const rows = [...components].sort((a, b) => b.pressure - a.pressure);
  const top = Math.max(1, pressure);
  return (
    <ul className="profile">
      {rows.map((c) => (
        <li key={c.id}>
          <button onClick={() => setSelected(c.id)}>
            <span className="profile-name">{c.name}</span>
            <span className={`profile-bar ${c.status}`}>
              <i style={{ width: `${Math.min(100, c.pressure / top * 100)}%` }} />
            </span>
            <span className="profile-value">{c.pressure.toFixed(1)} <small>psi</small></span>
            <span className="profile-value muted">{c.flow.toFixed(1)} <small>L/min</small></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Diagnostics({ onRepair }: { onRepair: (c: ComponentEntity) => void }) {
  const diagnostic = useStore((s) => s.diagnostic);
  const components = useStore((s) => s.components);
  const leaks = useStore((s) => s.leaks);
  const setSelected = useStore((s) => s.setSelected);
  const root = diagnostic.rootCause;
  const issues = [
    ...components
      .filter((c) => c.status === "failed" || c.status === "warning")
      .map((c) => ({
        key: c.id,
        id: c.id,
        tone: c.status,
        text: `${c.name} · ${c.status === "failed" ? "over its rating" : "near its limit"} at ${c.pressure.toFixed(0)} psi, health ${Math.round(c.health ?? 100)}%`,
      })),
    ...leaks
      .filter((leak) => leak.kind !== "outlet")
      .map((leak) => ({
        key: `${leak.component_id}-${leak.port_id}`,
        id: leak.component_id,
        tone: leak.kind === "break" ? "failed" : "warning",
        text: `${components.find((c) => c.id === leak.component_id)?.name ?? "Part"} · ${
          leak.kind === "break" ? "burst" : `open ${leak.port_id} port leaking`
        } at ${Math.round(leak.pressure)} psi`,
      })),
  ];
  const tone = root ? "failed" : issues.length ? "warning" : "normal";
  return (
    <div className="diagnostics">
      <div className={`callout ${tone}`}>
        <div className="callout-icon">
          {tone === "normal" ? <Activity size={18} /> : <AlertTriangle size={18} />}
        </div>
        <div className="grow">
          <strong>{root ? `Root cause: ${root.name}` : issues.length ? "Attention needed" : "System stable"}</strong>
          <p>{diagnostic.message}</p>
          {diagnostic.recommendation && <small>{diagnostic.recommendation}</small>}
        </div>
        {root && (
          <div className="callout-actions">
            <button className="btn" onClick={() => setSelected(root.id)}>Show</button>
            <button className="btn primary" onClick={() => onRepair(root)}>
              <Wrench size={14} /> Replace
            </button>
          </div>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((issue) => (
            <li key={issue.key} className={issue.tone}>
              <i />
              <span className="grow">{issue.text}</span>
              <button className="link" onClick={() => setSelected(issue.id)}>Show</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      <span><i className="swatch water" /> Water flowing</span>
      <span><i className="swatch warning" /> Near limit</span>
      <span><i className="swatch failed" /> Over rating</span>
      <span><i className="swatch gap" /> Broken joint</span>
    </div>
  );
}

export default function App() {
  const components = useStore((s) => s.components);
  const connectionCount = useStore((s) => s.connections.length);
  const selectedId = useStore((s) => s.selected);
  const placing = useStore((s) => s.placing);
  const pressure = useStore((s) => s.pressure);
  const running = useStore((s) => s.running);
  const diagnostic = useStore((s) => s.diagnostic);
  const leaks = useStore((s) => s.leaks);
  const customAssets = useStore((s) => s.customAssets);
  const activeCustom = useStore((s) => s.activeCustom);
  const connectionMode = useStore((s) => s.connectionMode);
  const apiStatus = useStore((s) => s.apiStatus);
  const apiError = useStore((s) => s.apiError);
  const pendingSaves = useStore((s) => s.pendingSaves);
  const moveAxis = useStore((s) => s.moveAxis);
  const rotateAxis = useStore((s) => s.rotateAxis);
  const {
    initialize,
    setPlacing,
    setPressure,
    runSimulation,
    stopSimulation,
    reset,
    remove,
    align,
    setRotation3,
    setPlacementRotation3,
    addCustomAsset,
    selectCustomAsset,
    setMoveAxis,
    setRotateAxis,
  } = useStore.getState();
  const [tab, setTab] = useState<Tab>("build");
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useNotice();
  const [dialog, setDialog] = useState<"help" | "custom" | null>(null);
  const selected = components.find((c) => c.id === selectedId);
  const escaping = leaks.filter((leak) => leak.kind !== "outlet").length;

  useEffect(() => {
    void initialize();
    void listStoredAssets()
      .then((assets) => useStore.getState().setCustomAssets(assets))
      .catch(() => {});
  }, [initialize]);

  const slots = useMemo(
    () => [
      ...parts.map((part) => ({
        key: part.type,
        name: part.name,
        description: String(part.properties.description ?? ""),
        type: part.type,
        pick: () => setPlacing(part.type),
        active: placing === part.type,
      })),
      ...customAssets.map((asset: CustomAsset) => ({
        key: asset.id,
        name: asset.name,
        description: asset.description,
        type: "custom" as const,
        pick: () => selectCustomAsset(asset),
        active: placing === "custom" && activeCustom?.id === asset.id,
      })),
    ].filter((slot) => slot.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [customAssets, filter, placing, activeCustom, setPlacing, selectCustomAsset],
  );

  // Number keys pick the matching inventory slot.
  useEffect(() => {
    const pick = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
      slots[Number(e.key) - 1]?.pick();
    };
    window.addEventListener("keydown", pick);
    return () => window.removeEventListener("keydown", pick);
  }, [slots]);

  const turn = (direction: 1 | -1) => {
    const i = { x: 0, y: 1, z: 2 }[rotateAxis];
    if (placing) {
      const r: Vec3 = [...useStore.getState().placementRotation3];
      r[i] += direction * Math.PI / 2;
      setPlacementRotation3(r);
    } else if (selected) {
      const r: Vec3 = selected.rotation3 ? [...selected.rotation3] : [0, selected.rotation, 0];
      r[i] += direction * Math.PI / 2;
      setRotation3(selected.id, r);
    }
  };

  const toggleSimulation = async () => {
    if (running) {
      stopSimulation();
      setNotice("Simulation stopped");
      return;
    }
    await runSimulation();
    if (useStore.getState().running) {
      setTab("diagnose");
      setNotice("Simulation running");
    }
  };

  const repair = useCallback((c: ComponentEntity) => {
    remove(c.id);
    setPlacing(c.type);
    setTab("repair");
  }, [remove, setPlacing]);

  const confirmReset = () => {
    if (window.confirm("Replace the current network with the starter layout? This cannot be undone.")) {
      void reset().then(() => setNotice("Starter network restored"));
    }
  };

  const saveState = apiStatus === "error"
    ? { tone: "offline", label: "Offline · changes not saved" }
    : apiStatus === "connecting"
    ? { tone: "connecting", label: "Connecting…" }
    : pendingSaves > 0
    ? { tone: "saving", label: "Saving…" }
    : { tone: "saved", label: "All changes saved" };
  const placingName = placing === "custom"
    ? activeCustom?.name
    : catalog.find((c) => c.type === placing)?.name;
  const mode = placing
    ? { tone: "accent", text: `Placing ${placingName}` }
    : connectionMode
    ? { tone: "accent", text: "Connecting · pick the second part" }
    : running
    ? { tone: "water", text: "Simulation running" }
    : { tone: "idle", text: "Editing" };

  return (
    <div className={`app ${selected ? "has-selection" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" />
            </svg>
          </span>
          <span className="brand-name">PipeLab</span>
        </div>
        <div className="project">
          <span className="project-name">Untitled system</span>
          <span className={`save-state ${saveState.tone}`}>
            {apiStatus === "error" ? <CloudOff size={14} /> : <Cloud size={14} />}
            {saveState.label}
          </span>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={() => setDialog("help")}>
            <CircleHelp size={16} /> <span className="hide-sm">Shortcuts</span>
          </button>
        </div>
      </header>

      <div className="workspace">
        <nav className="sidebar" aria-label="Workflow">
          <div className="tabs">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
              >
                <Icon size={17} />
                <span>{label}</span>
                {id === "diagnose" && (diagnostic.rootCause || escaping > 0) && <i className="dot" />}
              </button>
            ))}
          </div>
          <div className="pressure-card">
            <label htmlFor="source-pressure">
              <span>Source pressure</span>
              <b>{pressure} <small>psi</small></b>
            </label>
            <input
              id="source-pressure"
              type="range"
              min={0}
              max={200}
              step={5}
              value={pressure}
              onChange={(e) => setPressure(Number(e.target.value))}
            />
            <div className="stepper">
              <button aria-label="Decrease pressure" onClick={() => setPressure(Math.max(0, pressure - 5))}>−</button>
              <input
                aria-label="Source pressure value"
                type="number"
                min={0}
                max={200}
                value={pressure}
                onChange={(e) => setPressure(Math.max(0, Math.min(200, Number(e.target.value))))}
              />
              <button aria-label="Increase pressure" onClick={() => setPressure(Math.min(200, pressure + 5))}>+</button>
            </div>
          </div>
          <div className="sidebar-actions">
            <button className="btn" onClick={confirmReset}>
              <Undo2 size={15} /> <span>Reset network</span>
            </button>
            <button className={`btn primary run ${running ? "running" : ""}`} onClick={toggleSimulation}>
              {running ? <Pause size={15} /> : <Play size={15} />}
              <span>{running ? "Stop simulation" : "Run simulation"}</span>
            </button>
          </div>
        </nav>

        <main className="viewport">
          <div className="toolbar" role="toolbar" aria-label="Transform tools">
            <Segmented label="Move" options={["free", "x", "y", "z"] as const} value={moveAxis} onChange={setMoveAxis} />
            <div className="tool-group">
              <Segmented label="Rotate" options={["x", "y", "z"] as const} value={rotateAxis} onChange={setRotateAxis} />
              <button className="icon-btn" aria-label="Rotate −90°" title="Rotate −90° (Q)" disabled={!placing && !selected} onClick={() => turn(-1)}>
                <RotateCcw size={15} />
              </button>
              <button className="icon-btn" aria-label="Rotate +90°" title="Rotate +90° (E)" disabled={!placing && !selected} onClick={() => turn(1)}>
                <RotateCw size={15} />
              </button>
            </div>
            <div className="toolbar-end">
              <button
                className="btn ghost"
                title="Move connected parts so their ports meet"
                onClick={() => {
                  align();
                  setNotice("Connected ports aligned");
                }}
              >
                <Layers3 size={15} /> <span className="hide-md">Align joints</span>
              </button>
              <button
                className="icon-btn"
                aria-label="Frame all parts"
                title="Frame all parts"
                onClick={() => window.dispatchEvent(new CustomEvent("pipelab:frame-scene"))}
              >
                <Maximize2 size={15} />
              </button>
            </div>
          </div>

          <div className="stage">
            <NetworkScene />
            <div className={`mode-pill ${mode.tone}`}>
              <i /> {mode.text}
            </div>
            {apiError && (
              <div className="banner" role="alert">
                <CloudOff size={16} />
                <span>{apiError}</span>
                <button className="btn small" onClick={() => void initialize()}>Retry</button>
              </div>
            )}
            {(placing || connectionMode) && (
              <div className="hint">
                {placing
                  ? <>Click to place · <kbd>Q</kbd> <kbd>E</kbd> rotate · <kbd>Esc</kbd> cancel</>
                  : <>Click the part to connect to · <kbd>Esc</kbd> cancel</>}
              </div>
            )}
            {running && <Legend />}

            {tab !== "build" && (
              <section className="drawer" aria-label={tabs.find((t) => t.id === tab)?.label}>
                <header>
                  <h2>
                    {tab === "simulate" ? "Pressure profile" : tab === "diagnose" ? "Diagnostics" : "Repair"}
                  </h2>
                  <button className="icon-btn" aria-label="Close panel" onClick={() => setTab("build")}>×</button>
                </header>
                {!running && tab !== "repair"
                  ? (
                    <div className="empty-state">
                      <p>Run the simulation to see {tab === "simulate" ? "pressure and flow through each part" : "failures, leaks and wear"}.</p>
                      <button className="btn primary" onClick={toggleSimulation}>
                        <Play size={15} /> Run simulation
                      </button>
                    </div>
                  )
                  : tab === "simulate"
                  ? <PressureProfile />
                  : tab === "diagnose"
                  ? <Diagnostics onRepair={repair} />
                  : (
                    <p className="drawer-text">
                      {placing
                        ? `Click in the scene to place the replacement ${placingName}; it snaps onto the free port left behind.`
                        : "Run a simulation, then choose Replace on a failed part in Diagnostics."}
                    </p>
                  )}
              </section>
            )}
          </div>

          <footer className="statusbar">
            <span>{components.length} parts</span>
            <span>{connectionCount} joints</span>
            {running && <span className={escaping ? "danger-text" : ""}>{escaping} {escaping === 1 ? "leak" : "leaks"}</span>}
            <span className={`api ${apiStatus}`}>
              <i />
              {apiStatus === "connected" ? "API connected" : apiStatus === "connecting" ? "Connecting" : "API offline"}
            </span>
            <span className="statusbar-end">Grid 0.5 m</span>
          </footer>
        </main>

        <aside className="inspector" aria-label="Inspector">
          <Inspector />
        </aside>
      </div>

      <section className="dock" aria-label="Parts inventory">
        <header>
          <h2>Parts</h2>
          <label className="search">
            <Search size={14} />
            <input
              aria-label="Filter parts"
              placeholder="Filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <button className="btn primary small" onClick={() => setDialog("custom")}>
            <Plus size={14} /> New part
          </button>
        </header>
        <div className="slots">
          {slots.map((slot, i) => (
            <button
              key={slot.key}
              className={`slot ${slot.active ? "active" : ""}`}
              title={`${slot.name} — ${slot.description}`}
              aria-pressed={slot.active}
              onClick={slot.pick}
            >
              {i < 9 && <kbd>{i + 1}</kbd>}
              <PartIcon type={slot.type} size={24} />
              <span>{slot.name}</span>
            </button>
          ))}
          {slots.length === 0 && <p className="muted small">No parts match “{filter}”.</p>}
        </div>
      </section>

      {dialog === "help" && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === "custom" && (
        <CustomObjectDialog
          onClose={() => setDialog(null)}
          onCreate={async (asset) => {
            await addCustomAsset(asset);
            const saved = useStore.getState().customAssets;
            const created = saved[saved.length - 1];
            if (created) selectCustomAsset(created);
            setDialog(null);
            setNotice("Saved to your parts. Click in the scene to place it.");
          }}
        />
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}
