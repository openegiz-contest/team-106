import asyncio
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import paho.mqtt.client as mqtt

from config import (
    MQTT_HOST,
    MQTT_PORT,
    MQTT_TOPIC_PREFIX,
    DITTO_NAMESPACE,
    SIM_INTERVAL,
    SIM_SPEEDUP
)
from dispatcher import FleetDispatcher
from ditto_bootstrap import bootstrap_ditto
import mine_geometry

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("simulator-main")

dispatcher = FleetDispatcher(seed=42)
mqtt_client: mqtt.Client = None
is_running = True


def ditto_modify_features(name: str, features: dict) -> dict:
    """Format matching Eclipse Ditto protocol modify commands"""
    return {
        "topic": f"{DITTO_NAMESPACE}/{name}/things/twin/commands/modify",
        "path": "/features",
        "value": {feat: {"properties": props} for feat, props in features.items()}
    }


def publish_telemetry():
    if not mqtt_client:
        return

    snap = dispatcher.get_full_snapshot()
    kpi = snap["kpi"]

    # 1. Mine root
    mine_features = {
        "tonnes_mined": {"value": kpi["crusher_total_tonnes"], "unit": "t"},
        "avg_grade_cu": {"value": kpi["crusher_grade_cu"], "unit": "% Cu"},
        "trucks_active": {"value": kpi["active_trucks"], "unit": "trucks"},
        "dispatch_mode": {"value": dispatcher.dispatch_mode}
    }
    mqtt_client.publish(
        f"{MQTT_TOPIC_PREFIX}/mine-01",
        json.dumps(ditto_modify_features("mine-01", mine_features)),
        qos=0
    )

    # 2. Crusher
    crusher_features = {
        "throughput_tph": {"value": kpi["crusher_rolling_tph"], "unit": "t/h"},
        "feed_grade_cu": {"value": kpi["crusher_grade_cu"], "unit": "% Cu"},
        "tonnes_total": {"value": kpi["crusher_total_tonnes"], "unit": "t"},
        "state": {"value": "crushing" if dispatcher.crusher_active_truck else "idle"}
    }
    mqtt_client.publish(
        f"{MQTT_TOPIC_PREFIX}/crusher-01",
        json.dumps(ditto_modify_features("crusher-01", crusher_features)),
        qos=0
    )

    # 3. Excavators
    for exc in dispatcher.excavators.values():
        exc_features = {
            "state": {"value": exc.state},
            "face_grade_cu": {"value": exc.grade_cu, "unit": "% Cu"},
            "passes_total": {"value": exc.passes_total, "unit": "passes"},
            "queue_length": {"value": len(exc.queue), "unit": "trucks"}
        }
        mqtt_client.publish(
            f"{MQTT_TOPIC_PREFIX}/{exc.id}",
            json.dumps(ditto_modify_features(exc.id, exc_features)),
            qos=0
        )

    # 4. Haul Trucks
    for truck in dispatcher.trucks.values():
        truck_features = {
            "state": {"value": truck.state},
            "payload_t": {"value": round(truck.payload_t, 1), "unit": "t"},
            "speed_kmh": {"value": round(truck.speed_kmh, 1), "unit": "km/h"},
            "fuel_pct": {"value": truck.fuel_pct, "unit": "%"},
            "trips_total": {"value": truck.trips_completed, "unit": "trips"}
        }
        mqtt_client.publish(
            f"{MQTT_TOPIC_PREFIX}/{truck.id}",
            json.dumps(ditto_modify_features(truck.id, truck_features)),
            qos=0
        )


async def simulation_loop():
    log.info("Starting simulation loop with dt = %.2fs (speedup = %.0fx)...", SIM_INTERVAL, SIM_SPEEDUP)
    dt = SIM_INTERVAL * SIM_SPEEDUP
    step_count = 0

    while is_running:
        try:
            dispatcher.step(dt)
            publish_telemetry()
            step_count += 1
            if step_count % 30 == 0:
                kpi = dispatcher.get_full_snapshot()["kpi"]
                log.info(
                    "Sim: %5.1f min | Crusher: %6.1f t | Grade: %.3f %% Cu (target %.2f) | Mode: %s",
                    dispatcher.sim_time / 60.0,
                    kpi["crusher_total_tonnes"],
                    kpi["crusher_grade_cu"],
                    kpi["target_grade_cu"],
                    dispatcher.dispatch_mode
                )
        except Exception as e:
            log.error("Simulation tick error: %s", e)

        await asyncio.sleep(SIM_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mqtt_client, is_running
    log.info("Connecting to Mosquitto at %s:%d...", MQTT_HOST, MQTT_PORT)
    try:
        mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"openegiz-sim-{os.getpid()}")
        mqtt_client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
        mqtt_client.loop_start()
        log.info("MQTT client connected and loop started.")
    except Exception as e:
        log.warning("MQTT not available immediately (%s), will proceed without MQTT publishing.", e)

    # Launch Ditto bootstrap in separate daemon thread
    threading.Thread(target=bootstrap_ditto, daemon=True).start()

    # Launch background simulation task
    task = asyncio.create_task(simulation_loop())

    yield

    is_running = False
    task.cancel()
    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()


app = FastAPI(
    title="OpenEgiz Digital Mine Simulator & What-If Engine",
    description="Physics-based telemetry simulation and real-time dispatching scenario API for open-pit mine",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# --- Request Models ---
class ExcavatorFailureRequest(BaseModel):
    excavator_id: str = "excavator-01"


class DispatchModeRequest(BaseModel):
    mode: str = "MAX_TONNAGE"  # or QUALITY_BLEND


class RoadConditionRequest(BaseModel):
    condition: str = "slippery_ice"
    speed_factor: float = 0.55


# --- API Routes ---
@app.get("/health")
def health():
    return {"status": "ok", "service": "openegiz-mine-simulator", "sim_time_s": dispatcher.sim_time}


@app.get("/api/fleet")
def get_fleet_state():
    """Returns complete real-time spatial and physical state of all mine entities"""
    return dispatcher.get_full_snapshot()


@app.get("/api/map")
def get_mine_map():
    """Pit geometry (benches, spiral haul ramp, bench roads, faces, facilities) in local metres"""
    return mine_geometry.map_payload()


@app.get("/api/scenario/status")
def get_scenario_status():
    """Returns current active scenario parameters and operational mode"""
    return {
        "scenarios": dispatcher.active_scenarios,
        "kpi": dispatcher.get_full_snapshot()["kpi"]
    }


@app.post("/api/scenario/excavator-failure")
def scenario_excavator_failure(req: ExcavatorFailureRequest):
    """Scenario 1: Emergency breakdown of excavator in rich face, triggers automated truck rerouting"""
    res = dispatcher.trigger_excavator_failure(req.excavator_id)
    publish_telemetry()
    return res


@app.post("/api/scenario/excavator-repair")
def scenario_excavator_repair(req: ExcavatorFailureRequest):
    """Repair an excavator and return it to active loading duty"""
    res = dispatcher.repair_excavator(req.excavator_id)
    publish_telemetry()
    return res


@app.post("/api/scenario/dispatch-mode")
def scenario_dispatch_mode(req: DispatchModeRequest):
    """Scenario 2: Switch dispatch mode (MAX_TONNAGE vs QUALITY_BLEND)"""
    res = dispatcher.set_dispatch_mode(req.mode)
    publish_telemetry()
    return res


@app.post("/api/scenario/road-condition")
def scenario_road_condition(req: RoadConditionRequest):
    """Scenario 3: Winter road conditions (ice/snow) reducing ramp speeds by ~45%"""
    res = dispatcher.set_road_condition(req.condition, req.speed_factor)
    publish_telemetry()
    return res


@app.post("/api/scenario/reset")
def scenario_reset():
    """Reset all What-If scenarios back to normal baseline operations"""
    res = dispatcher.reset_scenarios()
    publish_telemetry()
    return res


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
