import base64
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request

log = logging.getLogger("ditto-bootstrap")

DITTO_URL = os.environ.get("DITTO_URL", "http://ditto-nginx:80").rstrip("/")
DITTO_USER = os.environ.get("DITTO_USER", "ditto")
DITTO_PASSWORD = os.environ.get("DITTO_PASSWORD", "ditto")
NAMESPACE = os.environ.get("DITTO_NAMESPACE", "org.openegiz.mine")

AUTH = "Basic " + base64.b64encode(f"{DITTO_USER}:{DITTO_PASSWORD}".encode()).decode()


def put_thing(thing_id: str, body: dict) -> int:
    url = f"{DITTO_URL}/api/2/things/{thing_id}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="PUT",
        headers={"Authorization": AUTH, "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.status


def build_twins_dict() -> dict:
    twins = {}

    # 1. Root Mine Twin
    twins[f"{NAMESPACE}:mine-01"] = {
        "policyId": "default:basic_policy",
        "attributes": {
            "name": "Цифровой рудник OpenEgiz (Карьер)",
            "kind": "mine",
            "_isType": False
        },
        "features": {
            "tonnes_mined": {"properties": {"value": 0.0, "unit": "t"}},
            "avg_grade_cu": {"properties": {"value": 1.05, "unit": "% Cu"}},
            "trucks_active": {"properties": {"value": 12, "unit": "trucks"}},
            "dispatch_mode": {"properties": {"value": "QUALITY_BLEND"}}
        }
    }

    # 2. Crusher
    twins[f"{NAMESPACE}:crusher-01"] = {
        "policyId": "default:basic_policy",
        "attributes": {
            "name": "Приёмный бункер дробилки ДК-01",
            "kind": "crusher",
            "_parents": f"{NAMESPACE}:mine-01",
            "_isType": False
        },
        "features": {
            "state": {"properties": {"value": "idle"}},
            "throughput_tph": {"properties": {"value": 0.0, "unit": "t/h"}},
            "feed_grade_cu": {"properties": {"value": 1.05, "unit": "% Cu"}},
            "tonnes_total": {"properties": {"value": 0.0, "unit": "t"}}
        }
    }

    # 3. Stockpile
    twins[f"{NAMESPACE}:stockpile-01"] = {
        "policyId": "default:basic_policy",
        "attributes": {
            "name": "Склад усреднения руды СУ-01",
            "kind": "stockpile",
            "_parents": f"{NAMESPACE}:mine-01",
            "_isType": False
        },
        "features": {
            "capacity_tonnes": {"properties": {"value": 50000.0, "unit": "t"}},
            "current_tonnes": {"properties": {"value": 12500.0, "unit": "t"}},
            "stockpile_grade_cu": {"properties": {"value": 1.30, "unit": "% Cu"}}
        }
    }

    # 4. 8 Ore Blocks
    data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    blocks_file = os.path.join(data_dir, "ore_blocks.json")
    if os.path.exists(blocks_file):
        with open(blocks_file, "r", encoding="utf-8") as f:
            blocks = json.load(f)
    else:
        blocks = {}

    for bid, bdata in blocks.items():
        twins[f"{NAMESPACE}:{bid}"] = {
            "policyId": "default:basic_policy",
            "attributes": {
                "name": bdata["name"],
                "kind": "geological_block",
                "horizon": bdata["horizon"],
                "rock_type": bdata["rock_type"],
                "_parents": f"{NAMESPACE}:mine-01",
                "_isType": False
            },
            "features": {
                "copper_pct": {"properties": {"value": bdata["copper_pct"], "unit": "% Cu"}},
                "iron_pct": {"properties": {"value": bdata["iron_pct"], "unit": "% Fe"}},
                "remaining_tonnes": {"properties": {"value": bdata["remaining_tonnes"], "unit": "t"}},
                "hardness_f": {"properties": {"value": bdata["hardness_f"], "unit": "f"}}
            }
        }

    # 5. 4 Excavators
    excavator_info = [
        ("excavator-01", "ЭКГ-15 №1 (Богатый 420м)", 1.65),
        ("excavator-02", "ЭКГ-15 №2 (Высокосортный 380м)", 1.85),
        ("excavator-03", "ЭКГ-15 №3 (Балансовый 340м)", 1.05),
        ("excavator-04", "ЭКГ-15 №4 (Глубокий 300м)", 1.45)
    ]
    for eid, ename, egrade in excavator_info:
        twins[f"{NAMESPACE}:{eid}"] = {
            "policyId": "default:basic_policy",
            "attributes": {
                "name": ename,
                "kind": "excavator",
                "_parents": f"{NAMESPACE}:mine-01",
                "_isType": False
            },
            "features": {
                "state": {"properties": {"value": "idle"}},
                "face_grade_cu": {"properties": {"value": egrade, "unit": "% Cu"}},
                "passes_total": {"properties": {"value": 0, "unit": "passes"}},
                "queue_length": {"properties": {"value": 0, "unit": "trucks"}}
            }
        }

    # 6. 12 Haul Trucks
    for i in range(1, 13):
        tid = f"truck-{i:02d}"
        tname = f"БелАЗ-75131 №{i:02d}"
        twins[f"{NAMESPACE}:{tid}"] = {
            "policyId": "default:basic_policy",
            "attributes": {
                "name": tname,
                "kind": "haul-truck",
                "capacity_tonnes": 130.0,
                "_parents": f"{NAMESPACE}:mine-01",
                "_isType": False
            },
            "features": {
                "state": {"properties": {"value": "queued_at_excavator"}},
                "payload_t": {"properties": {"value": 0.0, "unit": "t"}},
                "speed_kmh": {"properties": {"value": 0.0, "unit": "km/h"}},
                "fuel_pct": {"properties": {"value": 100.0, "unit": "%"}},
                "trips_total": {"properties": {"value": 0, "unit": "trips"}}
            }
        }

    return twins


def bootstrap_ditto():
    log.info("Connecting to Eclipse Ditto at %s...", DITTO_URL)
    twins = build_twins_dict()

    for attempt in range(40):
        try:
            # Test connection
            req = urllib.request.Request(
                f"{DITTO_URL}/api/2/things",
                headers={"Authorization": AUTH}
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    break
        except Exception:
            time.sleep(3)
    else:
        log.warning("Ditto not responding after 120s, proceeding anyway...")

    success_count = 0
    for thing_id, body in twins.items():
        try:
            status = put_thing(thing_id, body)
            log.info("[%s] %s", status, thing_id)
            success_count += 1
        except Exception as e:
            log.warning("Could not register %s: %s", thing_id, e)

    log.info("Ditto Bootstrap complete. Registered %d / %d twins.", success_count, len(twins))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    bootstrap_ditto()
