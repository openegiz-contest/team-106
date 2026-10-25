import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "simulator"))
import mine_geometry as geo  # noqa: E402

def generate_ore_blocks():
    blocks = {
        "block-01": {
            "id": "block-01",
            "name": "Добычной блок Б-420-1 (Богатая руда)",
            "horizon": 420,
            "rock_type": "rich_ore",
            "copper_pct": 1.65,
            "iron_pct": 24.5,
            "initial_tonnes": 240000.0,
            "remaining_tonnes": 240000.0,
            "hardness_f": 11,
            "density_t_m3": 2.75,
            "assigned_excavator": "excavator-01",
            "coordinates": [76.920, 43.230, 420]
        },
        "block-02": {
            "id": "block-02",
            "name": "Добычной блок Б-420-2 (Рядовая руда)",
            "horizon": 420,
            "rock_type": "medium_ore",
            "copper_pct": 1.10,
            "iron_pct": 21.0,
            "initial_tonnes": 310000.0,
            "remaining_tonnes": 310000.0,
            "hardness_f": 9,
            "density_t_m3": 2.65,
            "assigned_excavator": None,
            "coordinates": [76.916, 43.228, 420]
        },
        "block-03": {
            "id": "block-03",
            "name": "Добычной блок Б-380-1 (Высокосортная руда)",
            "horizon": 380,
            "rock_type": "rich_ore",
            "copper_pct": 1.85,
            "iron_pct": 26.2,
            "initial_tonnes": 190000.0,
            "remaining_tonnes": 190000.0,
            "hardness_f": 12,
            "density_t_m3": 2.80,
            "assigned_excavator": "excavator-02",
            "coordinates": [76.922, 43.226, 380]
        },
        "block-04": {
            "id": "block-04",
            "name": "Добычной блок Б-380-2 (Бедная руда)",
            "horizon": 380,
            "rock_type": "lean_ore",
            "copper_pct": 0.65,
            "iron_pct": 17.5,
            "initial_tonnes": 420000.0,
            "remaining_tonnes": 420000.0,
            "hardness_f": 8,
            "density_t_m3": 2.55,
            "assigned_excavator": None,
            "coordinates": [76.918, 43.224, 380]
        },
        "block-05": {
            "id": "block-05",
            "name": "Добычной блок Б-340-1 (Целевая шихта)",
            "horizon": 340,
            "rock_type": "standard_ore",
            "copper_pct": 1.05,
            "iron_pct": 20.0,
            "initial_tonnes": 350000.0,
            "remaining_tonnes": 350000.0,
            "hardness_f": 10,
            "density_t_m3": 2.68,
            "assigned_excavator": "excavator-03",
            "coordinates": [76.925, 43.222, 340]
        },
        "block-06": {
            "id": "block-06",
            "name": "Добычной блок Б-340-2 (Низкосортная руда)",
            "horizon": 340,
            "rock_type": "lean_ore",
            "copper_pct": 0.50,
            "iron_pct": 15.0,
            "initial_tonnes": 480000.0,
            "remaining_tonnes": 480000.0,
            "hardness_f": 8,
            "density_t_m3": 2.50,
            "assigned_excavator": None,
            "coordinates": [76.929, 43.224, 340]
        },
        "block-07": {
            "id": "block-07",
            "name": "Добычной блок Б-300-1 (Глубокий богатый забой)",
            "horizon": 300,
            "rock_type": "rich_ore",
            "copper_pct": 1.45,
            "iron_pct": 23.0,
            "initial_tonnes": 280000.0,
            "remaining_tonnes": 280000.0,
            "hardness_f": 13,
            "density_t_m3": 2.78,
            "assigned_excavator": "excavator-04",
            "coordinates": [76.928, 43.218, 300]
        },
        "block-08": {
            "id": "block-08",
            "name": "Добычной блок Б-260-Вскрыша",
            "horizon": 260,
            "rock_type": "waste",
            "copper_pct": 0.12,
            "iron_pct": 11.0,
            "initial_tonnes": 600000.0,
            "remaining_tonnes": 600000.0,
            "hardness_f": 7,
            "density_t_m3": 2.45,
            "assigned_excavator": None,
            "coordinates": [76.930, 43.214, 260]
        }
    }
    for bid, blk in blocks.items():
        blk["coordinates"] = geo.block_lonlat(bid)
    with open("data/ore_blocks.json", "w", encoding="utf-8") as f:
        json.dump(blocks, f, ensure_ascii=False, indent=2)
    print("Created data/ore_blocks.json with 8 blocks")


def _ring_lonlat(r: float, elev: float, steps: int = 72):
    pts = []
    for i in range(steps + 1):
        th = 2 * math.pi * i / steps
        x, y = geo.polar_xy(r, th)
        pts.append(geo.to_lonlat_elev((x, y, elev)))
    return pts


def _line_feature(fid, name, pts_local, props=None):
    coords = [geo.to_lonlat_elev(p) for p in pts_local]
    length = sum(math.dist(pts_local[i], pts_local[i + 1]) for i in range(len(pts_local) - 1))
    horiz = sum(math.hypot(pts_local[i + 1][0] - pts_local[i][0], pts_local[i + 1][1] - pts_local[i][1])
                for i in range(len(pts_local) - 1))
    dz = abs(pts_local[-1][2] - pts_local[0][2])
    p = {
        "id": fid,
        "name": name,
        "type": "haul_road",
        "length_m": round(length, 1),
        "gradient_pct": round(dz / horiz * 100.0, 1) if horiz > 0 else 0.0,
    }
    p.update(props or {})
    return {"type": "Feature", "properties": p, "geometry": {"type": "LineString", "coordinates": coords}}


def generate_mine_map():
    """GeoJSON из единой геометрии simulator/mine_geometry.py"""
    features = []

    pois = [
        ("crusher-01", "Приёмный бункер дробилки ДК-01", "crusher", {"capacity_tph": 1200}),
        ("stockpile-01", "Склад усреднения руды СУ-01", "stockpile", {"capacity_t": 50000}),
        ("waste-dump-01", "Северный отвал вскрышных пород ОВ-01", "waste_dump", {}),
    ]
    for fid, name, ftype, extra in pois:
        c = geo.facility_lonlat(fid)
        props = {"id": fid, "name": name, "type": ftype, "elevation": c[2]}
        props.update(extra)
        features.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": c}})

    excavator_points = [
        ("excavator-01", "ЭКГ-15 №1 (Богатый забой 420м)", "block-01", 1.65),
        ("excavator-02", "ЭКГ-15 №2 (Высокосортный 380м)", "block-03", 1.85),
        ("excavator-03", "ЭКГ-15 №3 (Балансовый 340м)", "block-05", 1.05),
        ("excavator-04", "ЭКГ-15 №4 (Глубокий горизонт 300м)", "block-07", 1.45),
    ]
    for eid, name, blk, grade in excavator_points:
        c = geo.excavator_lonlat(eid)
        features.append({
            "type": "Feature",
            "properties": {"id": eid, "name": name, "type": "excavator", "block_id": blk,
                           "copper_grade": grade, "bucket_capacity_m3": 15.0, "elevation": c[2]},
            "geometry": {"type": "Point", "coordinates": c},
        })

    # Контуры уступов: площадка между подошвой (toe) и бровкой (crest)
    for b in geo.BENCHES:
        outer = _ring_lonlat(b["toe"] or b["crest"] + 300.0, b["elev"])
        rings = [outer]
        if b["crest"] > 0:
            rings.append(list(reversed(_ring_lonlat(b["crest"], b["elev"]))))
        features.append({
            "type": "Feature",
            "properties": {"name": b["name"], "type": "bench", "elevation": b["elev"],
                           "toe_radius_m": b["toe"], "crest_radius_m": b["crest"]},
            "geometry": {"type": "Polygon", "coordinates": rings},
        })

    # Рудные блоки как сектора площадок
    for bid in geo.BLOCK_LAYOUT:
        s = geo.block_sector(bid)
        n = 16
        outer, inner = [], []
        for i in range(n + 1):
            th = s["theta_start"] + (s["theta_end"] - s["theta_start"]) * i / n
            outer.append(geo.to_lonlat_elev((*geo.polar_xy(s["r_outer"], th), s["elev"])))
            inner.append(geo.to_lonlat_elev((*geo.polar_xy(s["r_inner"], th), s["elev"])))
        ring = outer + list(reversed(inner)) + [outer[0]]
        features.append({
            "type": "Feature",
            "properties": {"id": bid, "type": "ore_block", "elevation": s["elev"]},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })

    # Главный спиральный съезд: участки между точками примыкания уступов
    ramp = geo.build_ramp()
    pts = ramp["points"]
    prev_idx, prev_node = 0, "crusher-01"
    for elev in sorted(ramp["junctions"].keys(), reverse=True):
        j = ramp["junctions"][elev]["index"]
        node = f"junc-{elev}"
        features.append(_line_feature(
            f"road-ramp-{elev}", f"Съезд → горизонт +{elev} м", pts[prev_idx:j + 1],
            {"from_node": prev_node, "to_node": node, "is_main_ramp": True, "max_speed_kmh": 35.0}))
        prev_idx, prev_node = j, node

    # Забойные дороги от точки примыкания к экскаватору
    for eid, lay in geo.EXCAVATOR_LAYOUT.items():
        route = geo.haul_route(eid)
        n_bench = route.seg_types.index(next(t for t in route.seg_types if t != "bench"))
        bench_pts = route.points[: n_bench + 1]
        features.append(_line_feature(
            f"road-spur-{eid}", f"Забойная дорога {eid} (+{int(lay['elev'])} м)", list(reversed(bench_pts)),
            {"from_node": f"junc-{int(lay['elev'])}", "to_node": eid, "is_main_ramp": False,
             "max_speed_kmh": 28.0, "haul_route_length_m": round(route.length_m, 1)}))

    # Поверхностная трасса дробилка -> склад
    features.append(_line_feature(
        "road-spur-stockpile", "Трасса на склад усреднения",
        [geo.facility_local("crusher-01"), geo.facility_local("stockpile-01")],
        {"from_node": "crusher-01", "to_node": "stockpile-01", "is_main_ramp": False, "max_speed_kmh": 35.0}))

    geojson = {
        "type": "FeatureCollection",
        "name": "OpenEgiz_OpenPit_Mine_Map",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": features,
    }
    with open("data/mine_map.geojson", "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=1)
    print("Created data/mine_map.geojson with POIs, benches, blocks and road network graph")


if __name__ == "__main__":
    generate_ore_blocks()
    generate_mine_map()
