import json
import logging
import math
import os
import random
import time
from typing import Dict, List, Optional
from physics_engine import (
    TRUCK_EMPTY_WEIGHT_T,
    FUEL_TANK_CAPACITY_L as TRUCK_TANK_CAPACITY_L,
    calculate_speed_and_fuel,
    calculate_shovel_loading_cycle
)
import mine_geometry as geo

QUEUE_SPACING_M = 28.0  # интервал между самосвалами в очереди

log = logging.getLogger("dispatcher")

TARGET_COPPER_GRADE = 1.05  # Target % Cu for processing plant
CRUSHER_WINDOW_SECONDS = 3600.0  # 1 hour rolling average

class HaulTruck:
    def __init__(self, truck_id: str, name: str, initial_fuel_pct: float = 90.0):
        self.id = truck_id
        self.name = name
        self.state = "queued_at_excavator"  # queued, spotting, loading, hauling, queued_at_crusher, dumping, returning, refueling
        self.target_excavator = "excavator-01"
        self.target_destination = "crusher-01"  # crusher-01 or stockpile-01
        self.payload_t = 0.0
        self.grade_cu = 0.0
        self.grade_fe = 0.0
        self.speed_kmh = 0.0
        self.route_progress = 0.0  # 0.0 (забой) .. 1.0 (дробилка)
        self.current_route_id = "route-excavator-01"
        self.current_coordinates = [76.9200, 43.2300, 420.0]
        self.local_position = [0.0, 0.0, 420.0]  # метры, локальная СК карьера
        self.heading = 0.0  # рад, направление движения в плане
        self.grade_pct = 0.0  # текущий уклон по ходу движения
        self.fuel_litres = (initial_fuel_pct / 100.0) * TRUCK_TANK_CAPACITY_L
        self.trips_completed = 0
        self.total_tonnes_hauled = 0.0
        self.timer = 0.0

    @property
    def fuel_pct(self) -> float:
        return round((self.fuel_litres / TRUCK_TANK_CAPACITY_L) * 100.0, 1)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "state": self.state,
            "target_excavator": self.target_excavator,
            "target_destination": self.target_destination,
            "payload_t": round(self.payload_t, 1),
            "grade_cu": round(self.grade_cu, 3),
            "grade_fe": round(self.grade_fe, 2),
            "speed_kmh": round(self.speed_kmh, 1),
            "route_progress": round(self.route_progress, 4),
            "route_id": self.current_route_id,
            "coordinates": self.current_coordinates,
            "local_position": [round(c, 1) for c in self.local_position],
            "heading": round(self.heading, 3),
            "grade_pct": round(self.grade_pct, 1),
            "fuel_pct": self.fuel_pct,
            "trips_completed": self.trips_completed,
            "total_tonnes_hauled": round(self.total_tonnes_hauled, 1)
        }


class Excavator:
    def __init__(self, exc_id: str, name: str, block_id: str, grade_cu: float, grade_fe: float, hardness_f: float, coords: list):
        self.id = exc_id
        self.name = name
        self.block_id = block_id
        self.grade_cu = grade_cu
        self.grade_fe = grade_fe
        self.hardness_f = hardness_f
        self.coordinates = coords
        self.state = "idle"  # idle, loading, breakdown
        self.queue: List[str] = []
        self.active_truck: Optional[str] = None
        self.passes_total = 0
        self.tonnes_loaded = 0.0
        self.cycle_specs = calculate_shovel_loading_cycle(hardness_f)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "block_id": self.block_id,
            "state": self.state,
            "grade_cu": self.grade_cu,
            "grade_fe": self.grade_fe,
            "hardness_f": self.hardness_f,
            "coordinates": self.coordinates,
            "queue_len": len(self.queue),
            "active_truck": self.active_truck,
            "passes_total": self.passes_total,
            "tonnes_loaded": round(self.tonnes_loaded, 1)
        }


class FleetDispatcher:
    def __init__(self, seed: int = 42):
        self.rng = random.Random(seed)
        self.sim_time = 0.0
        self.dispatch_mode = "QUALITY_BLEND"  # "QUALITY_BLEND" or "MAX_TONNAGE"
        self.road_condition = "normal"  # "normal" or "slippery_ice"
        self.road_speed_factor = 1.0
        self.active_scenarios = {
            "excavator_failure": False,
            "failed_excavator_id": None,
            "dispatch_mode": self.dispatch_mode,
            "road_condition": self.road_condition
        }

        # Load GeoJSON map and Ore Blocks
        self.load_data()

        # Initialize 4 Excavators
        self.excavators: Dict[str, Excavator] = {
            "excavator-01": Excavator("excavator-01", "ЭКГ-15 №1 (Богатый 420м)", "block-01", 1.65, 24.5, 11, geo.excavator_lonlat("excavator-01")),
            "excavator-02": Excavator("excavator-02", "ЭКГ-15 №2 (Высокосортный 380м)", "block-03", 1.85, 26.2, 12, geo.excavator_lonlat("excavator-02")),
            "excavator-03": Excavator("excavator-03", "ЭКГ-15 №3 (Балансовый 340м)", "block-05", 1.05, 20.0, 10, geo.excavator_lonlat("excavator-03")),
            "excavator-04": Excavator("excavator-04", "ЭКГ-15 №4 (Глубокий 300м)", "block-07", 1.45, 23.0, 13, geo.excavator_lonlat("excavator-04"))
        }
        # Маршруты рейсов (полилинии по съезду) для каждого забоя
        self.routes = {eid: geo.haul_route(eid) for eid in self.excavators}

        # Crusher queue must exist before trucks are staged
        self.crusher_queue: List[str] = []

        # Initialize 12 Haul Trucks spread across the fleet
        self.trucks: Dict[str, HaulTruck] = {}
        exc_keys = list(self.excavators.keys())
        for i in range(1, 13):
            tid = f"truck-{i:02d}"
            tname = f"БелАЗ-75131 №{i:02d}"
            truck = HaulTruck(tid, tname, initial_fuel_pct=self.rng.uniform(75, 98))
            assigned_exc = exc_keys[(i - 1) % len(exc_keys)]
            truck.target_excavator = assigned_exc
            # Stagger initial states
            phase = i % 4
            if phase == 0:
                truck.state = "queued_at_excavator"
                truck.current_coordinates = list(self.excavators[assigned_exc].coordinates)
                self.excavators[assigned_exc].queue.append(tid)
            elif phase == 1:
                truck.state = "hauling"
                truck.payload_t = 130.0
                truck.grade_cu = self.excavators[assigned_exc].grade_cu
                truck.grade_fe = self.excavators[assigned_exc].grade_fe
                truck.route_progress = self.rng.uniform(0.1, 0.7)
            elif phase == 2:
                truck.state = "returning"
                truck.payload_t = 0.0
                truck.route_progress = self.rng.uniform(0.2, 0.8)
            else:
                truck.state = "queued_at_crusher"
                truck.payload_t = 130.0
                truck.grade_cu = self.excavators[assigned_exc].grade_cu
                truck.grade_fe = self.excavators[assigned_exc].grade_fe
                truck.route_progress = 1.0
                self.crusher_queue.append(tid)

            self.trucks[tid] = truck

        # Crusher & Stockpile metrics
        self.crusher_active_truck: Optional[str] = None
        self.crusher_total_tonnes = 0.0
        self.crusher_weighted_cu_tonnes = 0.0
        self.crusher_weighted_fe_tonnes = 0.0
        self.crusher_dump_log = []  # list of (sim_time, tonnes, grade_cu)

        self.stockpile_total_tonnes = 12500.0
        self.stockpile_grade_cu = 1.30

        self.update_truck_positions()

    def retarget_truck(self, truck: "HaulTruck", new_exc: str):
        """Переназначение забоя с сохранением расстояния до дробилки (общий участок съезда)."""
        old = self.routes[truck.target_excavator]
        new = self.routes[new_exc]
        dist_to_crusher = (1.0 - truck.route_progress) * old.length_m
        truck.target_excavator = new_exc
        truck.route_progress = max(0.0, min(1.0, 1.0 - dist_to_crusher / new.length_m))

    def load_data(self):
        data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
        blocks_file = os.path.join(data_dir, "ore_blocks.json")
        if os.path.exists(blocks_file):
            with open(blocks_file, "r", encoding="utf-8") as f:
                self.ore_blocks = json.load(f)
        else:
            self.ore_blocks = {}

    def get_crusher_rolling_stats(self) -> tuple[float, float, float]:
        """Returns (rolling_grade_cu, rolling_tph, total_tonnes) over the last 1 hour"""
        cutoff = self.sim_time - CRUSHER_WINDOW_SECONDS
        recent = [entry for entry in self.crusher_dump_log if entry[0] >= cutoff]
        recent_tonnes = sum(r[1] for r in recent)
        if recent_tonnes > 0:
            rolling_cu = sum(r[1] * r[2] for r in recent) / recent_tonnes
        else:
            rolling_cu = TARGET_COPPER_GRADE

        window_hours = min(self.sim_time, CRUSHER_WINDOW_SECONDS) / 3600.0 or (1.0 / 3600.0)
        rolling_tph = recent_tonnes / window_hours
        return round(rolling_cu, 3), round(rolling_tph, 1), round(self.crusher_total_tonnes, 1)

    def select_next_excavator(self, truck: HaulTruck) -> str:
        """
        Intelligent dispatch logic:
        - MAX_TONNAGE: Picks active shovel with shortest queue.
        - QUALITY_BLEND: Optimizes crusher blend towards TARGET_COPPER_GRADE (1.05% Cu).
        """
        available_shovels = [
            exc for exc in self.excavators.values()
            if exc.state != "breakdown"
        ]
        if not available_shovels:
            return "excavator-01"

        if self.dispatch_mode == "MAX_TONNAGE":
            # Greedy: minimum queue length
            return min(available_shovels, key=lambda s: len(s.queue)).id

        # QUALITY_BLEND Mode
        rolling_cu, _, _ = self.get_crusher_rolling_stats()
        if rolling_cu < TARGET_COPPER_GRADE:
            # Need richer ore (prefer EX-01 [1.65%] or EX-02 [1.85%])
            candidates = [s for s in available_shovels if s.grade_cu >= TARGET_COPPER_GRADE]
            if candidates:
                return min(candidates, key=lambda s: len(s.queue)).id
        elif rolling_cu > TARGET_COPPER_GRADE + 0.10:
            # Need leaner ore to avoid giving away metal without recovery (prefer EX-03 [1.05%])
            candidates = [s for s in available_shovels if s.grade_cu <= TARGET_COPPER_GRADE + 0.2]
            if candidates:
                return min(candidates, key=lambda s: len(s.queue)).id

        # Standard balanced choice
        return min(available_shovels, key=lambda s: len(s.queue)).id

    def step(self, dt: float):
        self.sim_time += dt

        # 1. Update Excavators and their queues
        for exc_id, exc in self.excavators.items():
            if exc.state == "breakdown":
                continue

            if exc.active_truck is None and exc.queue:
                next_tid = exc.queue.pop(0)
                exc.active_truck = next_tid
                exc.state = "loading"
                truck = self.trucks[next_tid]
                truck.state = "spotting"
                truck.timer = 0.0

            if exc.active_truck:
                truck = self.trucks[exc.active_truck]
                truck.timer += dt
                specs = exc.cycle_specs

                if truck.state == "spotting":
                    if truck.timer >= 25.0:  # Spotting maneuver complete
                        truck.state = "loading"
                        truck.timer = 0.0

                elif truck.state == "loading":
                    # Load pass by pass
                    if truck.timer >= specs["pass_duration_s"] and truck.payload_t < specs["target_payload_t"]:
                        truck.timer -= specs["pass_duration_s"]
                        truck.payload_t = min(specs["target_payload_t"], truck.payload_t + specs["pass_tonnes"])
                        truck.grade_cu = exc.grade_cu
                        truck.grade_fe = exc.grade_fe
                        exc.passes_total += 1
                        exc.tonnes_loaded += specs["pass_tonnes"]

                        # Deplete geological block reserves in real-time
                        if exc.block_id in self.ore_blocks:
                            blk = self.ore_blocks[exc.block_id]
                            blk["remaining_tonnes"] = max(0.0, blk["remaining_tonnes"] - specs["pass_tonnes"])

                    if truck.payload_t >= specs["target_payload_t"] - 1.0:
                        # Fully loaded, depart shovel
                        exc.active_truck = None
                        exc.state = "idle"
                        truck.state = "hauling"
                        truck.route_progress = 0.0
                        truck.timer = 0.0

        # 2. Update Haul Trucks movement & physics
        for truck_id, truck in self.trucks.items():
            route = self.routes[truck.target_excavator]
            if truck.state == "hauling":
                # Loaded climb: local grade of the actual road segment (bench road ~0 %, ramp ~9 %)
                gradient = route.grade_pct_at(truck.route_progress)
                speed_limit = 35.0 if route.segment_type_at(truck.route_progress) != "bench" else 28.0
                gross_wt = TRUCK_EMPTY_WEIGHT_T + truck.payload_t
                speed_kmh, fuel_rate = calculate_speed_and_fuel(
                    gross_wt, gradient, speed_limit, self.road_speed_factor, self.rng
                )
                truck.speed_kmh = speed_kmh
                truck.grade_pct = gradient
                distance_travelled_km = (speed_kmh / 3600.0) * dt
                truck.route_progress += distance_travelled_km / (route.length_m / 1000.0)
                truck.fuel_litres = max(0.0, truck.fuel_litres - (fuel_rate / 3600.0) * dt)

                if truck.route_progress >= 1.0:
                    truck.state = "queued_at_crusher"
                    truck.route_progress = 1.0
                    truck.speed_kmh = 0.0
                    self.crusher_queue.append(truck.id)

            elif truck.state == "returning":
                # Empty descent: negative of the road grade towards the crusher
                gradient = -route.grade_pct_at(truck.route_progress)
                speed_limit = 40.0 if route.segment_type_at(truck.route_progress) != "bench" else 30.0
                gross_wt = TRUCK_EMPTY_WEIGHT_T
                speed_kmh, fuel_rate = calculate_speed_and_fuel(
                    gross_wt, gradient, speed_limit, self.road_speed_factor, self.rng
                )
                truck.speed_kmh = speed_kmh
                truck.grade_pct = gradient
                distance_travelled_km = (speed_kmh / 3600.0) * dt
                truck.route_progress -= distance_travelled_km / (route.length_m / 1000.0)
                truck.fuel_litres = max(0.0, truck.fuel_litres - (fuel_rate / 3600.0) * dt)

                if truck.route_progress <= 0.0:
                    if self.excavators[truck.target_excavator].state == "breakdown":
                        self.retarget_truck(truck, self.select_next_excavator(truck))
                        continue
                    truck.state = "queued_at_excavator"
                    truck.route_progress = 0.0
                    truck.speed_kmh = 0.0
                    self.excavators[truck.target_excavator].queue.append(truck.id)

            elif truck.state == "refueling":
                truck.timer += dt
                truck.speed_kmh = 0.0
                if truck.timer >= 300.0:  # 5 min refuel
                    truck.fuel_litres = TRUCK_TANK_CAPACITY_L
                    truck.state = "returning"
                    truck.route_progress = 1.0

        # 3. Crusher Hopper unloading
        if self.crusher_active_truck is None and self.crusher_queue:
            next_dump = self.crusher_queue.pop(0)
            self.crusher_active_truck = next_dump
            truck = self.trucks[next_dump]
            truck.state = "spotting_at_crusher"
            truck.timer = 0.0

        if self.crusher_active_truck:
            truck = self.trucks[self.crusher_active_truck]
            truck.timer += dt
            if truck.state == "spotting_at_crusher" and truck.timer >= 20.0:
                truck.state = "dumping"
                truck.timer = 0.0
            elif truck.state == "dumping" and truck.timer >= 45.0:
                # Dump completed
                self.crusher_total_tonnes += truck.payload_t
                self.crusher_weighted_cu_tonnes += truck.payload_t * truck.grade_cu
                self.crusher_weighted_fe_tonnes += truck.payload_t * truck.grade_fe
                self.crusher_dump_log.append((self.sim_time, truck.payload_t, truck.grade_cu))

                truck.trips_completed += 1
                truck.total_tonnes_hauled += truck.payload_t
                truck.payload_t = 0.0
                self.crusher_active_truck = None

                # Refuel decision or next dispatch
                if truck.fuel_pct < 15.0:
                    truck.state = "refueling"
                    truck.timer = 0.0
                else:
                    truck.state = "returning"
                    truck.route_progress = 1.0
                    # Intelligent Dispatch for the next cycle
                    truck.target_excavator = self.select_next_excavator(truck)

        # Trim old dumps beyond window
        cutoff = self.sim_time - CRUSHER_WINDOW_SECONDS
        self.crusher_dump_log = [d for d in self.crusher_dump_log if d[0] >= cutoff]

        # 4. Spatial placement of every truck on its haul road
        self.update_truck_positions()

    def update_truck_positions(self):
        """Положение самосвалов на полилинии рейса (очереди выстраиваются вдоль дороги)."""
        for truck in self.trucks.values():
            route = self.routes[truck.target_excavator]
            truck.current_route_id = f"route-{truck.target_excavator}"
            slot = QUEUE_SPACING_M / route.length_m
            st = truck.state
            direction = 1.0
            if st == "queued_at_excavator":
                exc = self.excavators[truck.target_excavator]
                idx = exc.queue.index(truck.id) if truck.id in exc.queue else 0
                prog = slot * (idx + 1.5)
                direction = -1.0
            elif st in ("spotting", "loading"):
                prog = 0.0
                direction = -1.0
            elif st == "queued_at_crusher":
                idx = self.crusher_queue.index(truck.id) if truck.id in self.crusher_queue else 0
                prog = 1.0 - slot * (idx + 1.5)
            elif st in ("spotting_at_crusher", "dumping", "refueling"):
                prog = 1.0
            elif st == "returning":
                prog = truck.route_progress
                direction = -1.0
            else:  # hauling
                prog = truck.route_progress

            prog = max(0.0, min(1.0, prog))
            p = route.point_at(prog)
            p_ahead = route.point_at(max(0.0, min(1.0, prog + direction * 0.004)))
            if math.dist(p[:2], p_ahead[:2]) < 1e-3:
                p_ahead = route.point_at(max(0.0, min(1.0, prog - direction * 0.004)))
                truck.heading = math.atan2(p[1] - p_ahead[1], p[0] - p_ahead[0])
            else:
                truck.heading = math.atan2(p_ahead[1] - p[1], p_ahead[0] - p[0])
            truck.local_position = list(p)
            truck.current_coordinates = geo.to_lonlat_elev(p)
            if st not in ("hauling", "returning"):
                truck.grade_pct = 0.0

    # --- What-If Scenario Triggers ---
    def trigger_excavator_failure(self, exc_id: str = "excavator-01") -> dict:
        if exc_id in self.excavators:
            exc = self.excavators[exc_id]
            exc.state = "breakdown"
            # Самосвал под погрузкой уезжает с тем, что успели загрузить
            if exc.active_truck:
                t = self.trucks[exc.active_truck]
                exc.active_truck = None
                if t.payload_t > 0:
                    t.state = "hauling"
                    t.route_progress = 0.0
                else:
                    exc.queue.insert(0, t.id)
                    t.state = "queued_at_excavator"
            # Re-route waiting trucks immediately
            orphaned = list(exc.queue)
            exc.queue.clear()
            for tid in orphaned:
                truck = self.trucks[tid]
                new_exc = self.select_next_excavator(truck)
                truck.target_excavator = new_exc
                truck.route_progress = 0.0
                self.excavators[new_exc].queue.append(tid)
            # Порожние самосвалы, ехавшие к аварийному экскаватору, перенаправляются сразу
            for truck in self.trucks.values():
                if truck.state == "returning" and truck.target_excavator == exc_id:
                    self.retarget_truck(truck, self.select_next_excavator(truck))
            self.update_truck_positions()

            self.active_scenarios["excavator_failure"] = True
            self.active_scenarios["failed_excavator_id"] = exc_id
            return {"status": "ok", "message": f"{exc.name} stopped for emergency repair. {len(orphaned)} trucks rerouted."}
        return {"status": "error", "message": f"Excavator {exc_id} not found"}

    def repair_excavator(self, exc_id: str) -> dict:
        if exc_id in self.excavators:
            exc = self.excavators[exc_id]
            exc.state = "idle"
            has_other_breakdown = any(e.state == "breakdown" for e in self.excavators.values())
            if not has_other_breakdown:
                self.active_scenarios["excavator_failure"] = False
                self.active_scenarios["failed_excavator_id"] = None
            return {"status": "ok", "message": f"{exc.name} отремонтирован и возвращён в работу."}
        return {"status": "error", "message": f"Excavator {exc_id} not found"}

    def set_dispatch_mode(self, mode: str) -> dict:
        if mode in ("MAX_TONNAGE", "QUALITY_BLEND"):
            self.dispatch_mode = mode
            self.active_scenarios["dispatch_mode"] = mode
            return {"status": "ok", "mode": mode, "message": f"Dispatch mode switched to {mode}"}
        return {"status": "error", "message": "Invalid mode"}

    def set_road_condition(self, condition: str = "slippery_ice", speed_factor: float = 0.55) -> dict:
        self.road_condition = condition
        self.road_speed_factor = speed_factor if condition == "slippery_ice" else 1.0
        self.active_scenarios["road_condition"] = condition
        return {
            "status": "ok",
            "condition": condition,
            "speed_factor": self.road_speed_factor,
            "message": f"Road condition set to {condition}. Speed limit adjusted by {int(self.road_speed_factor * 100)}%"
        }

    def reset_scenarios(self) -> dict:
        for exc in self.excavators.values():
            if exc.state == "breakdown":
                exc.state = "idle"
        self.dispatch_mode = "QUALITY_BLEND"
        self.road_condition = "normal"
        self.road_speed_factor = 1.0
        self.active_scenarios = {
            "excavator_failure": False,
            "failed_excavator_id": None,
            "dispatch_mode": "QUALITY_BLEND",
            "road_condition": "normal"
        }
        return {"status": "ok", "message": "All what-if scenarios reset to baseline standard operating parameters."}

    def get_full_snapshot(self) -> dict:
        rolling_cu, rolling_tph, total_t = self.get_crusher_rolling_stats()
        return {
            "crusher": {
                "queue_len": len(self.crusher_queue),
                "active_truck": self.crusher_active_truck,
                "state": "crushing" if self.crusher_active_truck else "idle"
            },
            "routes": {eid: round(r.length_m, 1) for eid, r in self.routes.items()},
            "sim_time_minutes": round(self.sim_time / 60.0, 1),
            "kpi": {
                "crusher_total_tonnes": total_t,
                "crusher_rolling_tph": rolling_tph,
                "crusher_grade_cu": rolling_cu,
                "target_grade_cu": TARGET_COPPER_GRADE,
                "grade_deviation": round(rolling_cu - TARGET_COPPER_GRADE, 3),
                "active_trucks": sum(1 for t in self.trucks.values() if t.state in ("hauling", "returning")),
                "queued_trucks": len(self.crusher_queue) + sum(len(e.queue) for e in self.excavators.values()),
                "total_trips": sum(t.trips_completed for t in self.trucks.values())
            },
            "scenarios": self.active_scenarios,
            "excavators": [e.to_dict() for e in self.excavators.values()],
            "trucks": [t.to_dict() for t in self.trucks.values()],
            "blocks": list(self.ore_blocks.values())
        }
