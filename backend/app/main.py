import json
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from .database import Base, SessionLocal, engine
from . import models
from .schemas import AssetCreate, ComponentCreate, ConnectionCreate, EventEnvelope, ProjectCreate, ProjectUpdate, ResetRequest, SimulationRequest
from .simulation import run_simulation

Base.metadata.create_all(bind=engine)
app = FastAPI(title='PipeLab Digital Twin API', version='0.1.0')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])
connections: dict[str, set[WebSocket]] = {}

def db_session():
    db = SessionLocal()
    try: yield db
    finally: db.close()

def as_component(c):
    properties=c.properties or {}
    return {'id':c.id,'type':c.type,'name':c.name,'position':c.position,'rotation':c.rotation,'rotation3':properties.get('rotation3'),'material':c.material,'diameter':c.diameter,'length':c.length,'max_pressure':c.max_pressure,'pressure_loss':c.pressure_loss,'flow_resistance':c.flow_resistance,'open':c.open,'opening':c.opening,'ports':c.ports,'properties':properties,'fluid':properties.get('fluid','Fresh water'),'ageDays':properties.get('ageDays',0),'pressure':0,'flow':0,'status':'normal'}
def as_project(p):
    return {'id':p.id,'name':p.name,'source_pressure':p.source_pressure,'components':[as_component(c) for c in p.components],'connections':[{'id':c.id,'from_component':c.from_component,'from_port':c.from_port,'to_component':c.to_component,'to_port':c.to_port} for c in p.connections]}
async def publish(project_id: str, event: dict):
    stale=[]
    for socket in connections.get(project_id,set()):
        try: await socket.send_json(event)
        except Exception: stale.append(socket)
    for socket in stale: connections[project_id].discard(socket)

@app.get('/health')
def health(): return {'status':'ok','api_version':1}

@app.post('/projects')
def create_project(payload: ProjectCreate, db: Session=Depends(db_session)):
    project=models.Project(name=payload.name); db.add(project); db.commit(); db.refresh(project); return as_project(project)

@app.get('/projects')
def list_projects(db: Session=Depends(db_session)): return [{'id':p.id,'name':p.name,'source_pressure':p.source_pressure} for p in db.query(models.Project).all()]

@app.get('/projects/{project_id}')
def get_project(project_id: str, db: Session=Depends(db_session)):
    p=db.get(models.Project,project_id)
    if not p: raise HTTPException(404,'Project not found')
    return as_project(p)

@app.put('/projects/{project_id}')
def update_project(project_id: str, payload: ProjectUpdate, db: Session=Depends(db_session)):
    p=db.get(models.Project,project_id)
    if not p: raise HTTPException(404,'Project not found')
    if payload.name is not None: p.name=payload.name
    if payload.source_pressure is not None: p.source_pressure=payload.source_pressure
    db.commit(); db.refresh(p); return as_project(p)

@app.post('/projects/{project_id}/components')
async def add_component(project_id: str, payload: ComponentCreate, db: Session=Depends(db_session)):
    if not db.get(models.Project,project_id): raise HTTPException(404,'Project not found')
    c=models.ProjectComponent(project_id=project_id, **payload.model_dump(exclude={'id'}));
    if payload.id: c.id=payload.id
    db.add(c); db.commit(); db.refresh(c); await publish(project_id, {'version':1,'type':'component_added','project_id':project_id,'payload':as_component(c)}); return as_component(c)

@app.put('/projects/{project_id}/components/{component_id}')
async def update_component(project_id: str, component_id: str, payload: ComponentCreate, db: Session=Depends(db_session)):
    c=db.query(models.ProjectComponent).filter_by(project_id=project_id,id=component_id).first()
    if not c: raise HTTPException(404,'Component not found')
    for key,value in payload.model_dump(exclude={'id'}).items(): setattr(c,key,value)
    db.commit(); await publish(project_id, {'version':1,'type':'component_updated','project_id':project_id,'payload':as_component(c)}); return as_component(c)

@app.delete('/projects/{project_id}/components/{component_id}')
async def delete_component(project_id: str, component_id: str, db: Session=Depends(db_session)):
    c=db.query(models.ProjectComponent).filter_by(project_id=project_id,id=component_id).first()
    if not c: raise HTTPException(404,'Component not found')
    db.query(models.Connection).filter(models.Connection.project_id==project_id).filter((models.Connection.from_component==component_id)|(models.Connection.to_component==component_id)).delete(synchronize_session=False); db.delete(c); db.commit(); await publish(project_id, {'version':1,'type':'component_removed','project_id':project_id,'payload':{'component_id':component_id}}); return {'ok':True}

@app.post('/projects/{project_id}/connections')
async def add_connection(project_id: str, payload: ConnectionCreate, db: Session=Depends(db_session)):
    if not db.get(models.Project,project_id): raise HTTPException(404,'Project not found')
    c=models.Connection(project_id=project_id, **payload.model_dump(exclude={'id'}))
    if payload.id: c.id=payload.id
    db.add(c); db.commit(); connection={'id':c.id,**payload.model_dump(exclude={'id'})}
    await publish(project_id, {'version':1,'type':'connection_created','project_id':project_id,'payload':connection}); return connection

@app.delete('/projects/{project_id}/connections/{connection_id}')
async def delete_connection(project_id: str, connection_id: str, db: Session=Depends(db_session)):
    c=db.query(models.Connection).filter_by(project_id=project_id,id=connection_id).first()
    if not c: raise HTTPException(404,'Connection not found')
    db.delete(c); db.commit(); await publish(project_id, {'version':1,'type':'connection_removed','project_id':project_id,'payload':{'connection_id':connection_id}}); return {'ok':True}

@app.post('/projects/{project_id}/simulate')
async def simulate_project(project_id: str, payload: SimulationRequest, db: Session=Depends(db_session)):
    p=db.get(models.Project,project_id)
    if not p: raise HTTPException(404,'Project not found')
    result=run_simulation([as_component(c) for c in p.components],[{'from_component':c.from_component,'from_port':c.from_port,'to_component':c.to_component,'to_port':c.to_port} for c in p.connections],payload.source_pressure)
    sim=models.Simulation(project_id=project_id,source_pressure=payload.source_pressure,result=result); db.add(sim); db.add(models.SimulationEvent(project_id=project_id,event_type='simulation_completed',payload={'pressure':payload.source_pressure,'diagnostic':result['diagnostic'],'leaks':result['leaks']})); db.commit(); await publish(project_id, {'version':1,'type':'simulation_completed','project_id':project_id,'payload':result}); return result

@app.post('/projects/{project_id}/reset')
async def reset_project(project_id: str, payload: ResetRequest | None = None, db: Session=Depends(db_session)):
    """Replace the whole network in one transaction, so an interrupted reset cannot leave it half built."""
    payload=payload or ResetRequest()
    p=db.get(models.Project,project_id)
    if not p: raise HTTPException(404,'Project not found')
    db.query(models.Simulation).filter_by(project_id=project_id).delete()
    db.query(models.SimulationEvent).filter_by(project_id=project_id).delete()
    db.query(models.Connection).filter_by(project_id=project_id).delete()
    db.query(models.ProjectComponent).filter_by(project_id=project_id).delete()
    for component in payload.components:
        c=models.ProjectComponent(project_id=project_id, **component.model_dump(exclude={'id'}))
        if component.id: c.id=component.id
        db.add(c)
    for connection in payload.connections:
        c=models.Connection(project_id=project_id, **connection.model_dump(exclude={'id'}))
        if connection.id: c.id=connection.id
        db.add(c)
    p.source_pressure=payload.source_pressure
    db.commit(); db.refresh(p)
    project=as_project(p)
    await publish(project_id, {'version':1,'type':'project_reset','project_id':project_id,'payload':project})
    return project

@app.get('/projects/{project_id}/diagnostics')
def diagnostics(project_id: str, db: Session=Depends(db_session)):
    sim=db.query(models.Simulation).filter_by(project_id=project_id).order_by(models.Simulation.id.desc()).first()
    if not sim: return {'root_cause':None,'secondary_effects':[],'message':'No simulation results yet.','recommendation':'Run a simulation to evaluate the network.'}
    return sim.result['diagnostic']

@app.post('/assets')
def add_asset(payload: AssetCreate, db: Session=Depends(db_session)):
    asset=models.Asset(name=payload.name,category=payload.category,model=payload.model,metadata_json=payload.metadata); db.add(asset); db.commit(); db.refresh(asset); return {'id':asset.id,'name':asset.name,'category':asset.category,'model':asset.model,'metadata':asset.metadata_json}
@app.get('/assets')
def list_assets(db: Session=Depends(db_session)): return [{'id':a.id,'name':a.name,'category':a.category,'model':a.model,'metadata':a.metadata_json} for a in db.query(models.Asset).all()]
@app.get('/assets/{asset_id}')
def get_asset(asset_id: str, db: Session=Depends(db_session)):
    a=db.get(models.Asset,asset_id)
    if not a: raise HTTPException(404,'Asset not found')
    return {'id':a.id,'name':a.name,'category':a.category,'model':a.model,'metadata':a.metadata_json}

@app.websocket('/ws/projects/{project_id}')
async def project_events(socket: WebSocket, project_id: str):
    await socket.accept(); connections.setdefault(project_id,set()).add(socket)
    try:
        while True:
            raw=await socket.receive_text()
            try:
                event=EventEnvelope.model_validate_json(raw)
                if event.project_id != project_id: continue
                await publish(project_id,event.model_dump())
            except Exception:
                await socket.send_json({'version':1,'type':'error','project_id':project_id,'payload':{'message':'Invalid event envelope'}})
    except WebSocketDisconnect:
        connections.get(project_id,set()).discard(socket)
