from pydantic import BaseModel, Field
from typing import Any, Literal

class Port(BaseModel):
    id: str
    direction: Literal['input', 'output', 'bidirectional'] = 'bidirectional'
    position: list[float] = [0, 0, 0]
    vector: list[float] = [1, 0, 0]
    diameter: float = 0.25

class ComponentCreate(BaseModel):
    id: str | None = None
    type: str
    name: str
    position: list[float]
    rotation: float = 0
    material: str = 'PVC'
    diameter: float = 0.25
    length: float = 1
    max_pressure: float = 70
    pressure_loss: float = 0
    flow_resistance: float = 1
    open: bool = True
    opening: float = 1
    ports: list[Port] = Field(default_factory=list)
    properties: dict[str, Any] = Field(default_factory=dict)

class ConnectionCreate(BaseModel):
    id: str | None = None
    from_component: str
    from_port: str
    to_component: str
    to_port: str

class ProjectCreate(BaseModel):
    name: str = 'Untitled system'

class ProjectUpdate(BaseModel):
    name: str | None = None
    source_pressure: float | None = None

class SimulationRequest(BaseModel):
    source_pressure: float = Field(40, ge=0, le=300)

class ResetRequest(BaseModel):
    """Replacement network applied atomically by a project reset; empty clears the project."""
    components: list[ComponentCreate] = Field(default_factory=list)
    connections: list[ConnectionCreate] = Field(default_factory=list)
    source_pressure: float = Field(40, ge=0, le=300)

class AssetCreate(BaseModel):
    name: str
    category: str
    model: str
    metadata: dict[str, Any] = Field(default_factory=dict)

class EventEnvelope(BaseModel):
    version: int = 1
    type: str
    project_id: str
    payload: dict[str, Any] = Field(default_factory=dict)
