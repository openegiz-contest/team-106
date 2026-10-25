import math
import random

# Equipment physical specifications (BelAZ-75131 & EKG-15)
TRUCK_EMPTY_WEIGHT_T = 107.0
TRUCK_NOMINAL_PAYLOAD_T = 130.0
TRUCK_ENGINE_POWER_KW = 1194.0  # Cummins KTA50-C
TRANSMISSION_EFFICIENCY = 0.82
ROLLING_RESISTANCE_BASE = 0.025
GRAVITY = 9.81  # m/s^2

# Speed limits (km/h) under normal operating conditions
MAX_SPEED_EMPTY_FLAT_KMH = 45.0
MAX_SPEED_EMPTY_DOWNHILL_KMH = 35.0
MAX_SPEED_LOADED_FLAT_KMH = 38.0
MIN_SPEED_LOADED_UPHILL_KMH = 12.0

# Fuel consumption constants (litres per hour)
FUEL_IDLE_L_H = 18.0
FUEL_FULL_LOAD_L_H = 145.0
FUEL_TANK_CAPACITY_L = 1900.0


def calculate_speed_and_fuel(
    gross_weight_t: float,
    gradient_pct: float,
    speed_limit_kmh: float,
    road_condition_factor: float = 1.0,
    rng: random.Random = None
) -> tuple[float, float]:
    """
    Calculates realistic vehicle speed (km/h) and fuel burn rate (l/h)
    based on gross weight, road slope gradient, speed limits, and road condition.
    """
    if rng is None:
        noise = 1.0
    else:
        noise = rng.uniform(0.96, 1.04)

    effective_speed_limit = speed_limit_kmh * road_condition_factor
    mass_kg = gross_weight_t * 1000.0

    # Effective resistance coefficients
    # Rolling resistance increases if road is degraded or snowy
    c_rr = ROLLING_RESISTANCE_BASE / max(0.5, road_condition_factor)
    c_grade = gradient_pct / 100.0
    total_resistance_coef = c_rr + c_grade

    if gradient_pct > 2.0:
        # Climbing uphill - power limited
        resistance_force_n = mass_kg * GRAVITY * total_resistance_coef
        available_power_w = TRUCK_ENGINE_POWER_KW * 1000.0 * TRANSMISSION_EFFICIENCY
        steady_speed_ms = available_power_w / max(1000.0, resistance_force_n)
        steady_speed_kmh = steady_speed_ms * 3.6 * noise
        # Bound between minimum low-gear climbing speed and speed limit
        speed_kmh = min(effective_speed_limit, max(MIN_SPEED_LOADED_UPHILL_KMH, steady_speed_kmh))
        # High engine load factor
        engine_load = min(1.0, 0.4 + (gradient_pct / 12.0) * 0.6)
    elif gradient_pct < -2.0:
        # Descending downhill - retarder brake limited
        retarder_speed_limit = min(effective_speed_limit, MAX_SPEED_EMPTY_DOWNHILL_KMH)
        speed_kmh = retarder_speed_limit * noise * 0.95
        # Low engine load on descent (hydrodynamic braking)
        engine_load = 0.25
    else:
        # Relatively flat road
        max_flat = MAX_SPEED_LOADED_FLAT_KMH if gross_weight_t > 150.0 else MAX_SPEED_EMPTY_FLAT_KMH
        speed_kmh = min(effective_speed_limit, max_flat) * noise
        engine_load = 0.55 if gross_weight_t > 150.0 else 0.40

    fuel_rate_l_h = FUEL_IDLE_L_H + (FUEL_FULL_LOAD_L_H - FUEL_IDLE_L_H) * engine_load
    return round(speed_kmh, 1), round(fuel_rate_l_h, 2)


def calculate_shovel_loading_cycle(rock_hardness_f: float, bucket_capacity_m3: float = 15.0) -> dict:
    """
    Computes pass duration and pass count for loading BelAZ-130t with EKG-15 shovel.
    Protodyakonov scale hardness (f=7..14) impacts cycle duration and fill factor.
    """
    # Harder rock has lower bucket fill factor and longer cycle time
    fill_factor = max(0.85, min(1.05, 1.05 - (rock_hardness_f - 8) * 0.025))
    pass_tonnes = bucket_capacity_m3 * 1.65 * fill_factor  # ~24-26 t loose rock
    pass_duration_s = 28.0 + (rock_hardness_f - 8.0) * 1.5
    total_passes = math.ceil(TRUCK_NOMINAL_PAYLOAD_T / pass_tonnes)

    return {
        "pass_duration_s": round(pass_duration_s, 1),
        "pass_tonnes": round(pass_tonnes, 1),
        "total_passes": total_passes,
        "total_load_time_s": round(total_passes * pass_duration_s, 1),
        "target_payload_t": round(min(136.0, total_passes * pass_tonnes), 1)
    }
