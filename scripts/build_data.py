import json
import math

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
    with open("data/ore_blocks.json", "w", encoding="utf-8") as f:
        json.dump(blocks, f, ensure_ascii=False, indent=2)
    print("Created data/ore_blocks.json with 8 blocks")

def generate_mine_map():
    # Pit road network graph connecting crusher, stockpile, waste dump and excavator loading points
    features = []

    # 1. Primary Crusher Point
    features.append({
        "type": "Feature",
        "properties": {
            "id": "crusher-01",
            "name": "Приёмный бункер дробилки ДК-01",
            "type": "crusher",
            "elevation": 460.0,
            "capacity_tph": 1200
        },
        "geometry": {
            "type": "Point",
            "coordinates": [76.9250, 43.2350, 460.0]
        }
    })

    # 2. Blending Stockpile Point
    features.append({
        "type": "Feature",
        "properties": {
            "id": "stockpile-01",
            "name": "Склад усреднения руды СУ-01",
            "type": "stockpile",
            "elevation": 455.0,
            "capacity_t": 50000
        },
        "geometry": {
            "type": "Point",
            "coordinates": [76.9300, 43.2380, 455.0]
        }
    })

    # 3. Waste Dump Point
    features.append({
        "type": "Feature",
        "properties": {
            "id": "waste-dump-01",
            "name": "Северный отвал вскрышных пород ОВ-01",
            "type": "waste_dump",
            "elevation": 470.0
        },
        "geometry": {
            "type": "Point",
            "coordinates": [76.9150, 43.2400, 470.0]
        }
    })

    # 4. Excavators Loading Points
    excavator_points = [
        ("excavator-01", "ЭКГ-15 №1 (Богатый забой 420м)", [76.9200, 43.2300, 420.0], "block-01", 1.65),
        ("excavator-02", "ЭКГ-15 №2 (Высокосортный 380м)", [76.9220, 43.2260, 380.0], "block-03", 1.85),
        ("excavator-03", "ЭКГ-15 №3 (Балансовый 340м)", [76.9250, 43.2220, 340.0], "block-05", 1.05),
        ("excavator-04", "ЭКГ-15 №4 (Глубокий горизонт 300м)", [76.9280, 43.2180, 300.0], "block-07", 1.45)
    ]

    for eid, name, coords, blk, grade in excavator_points:
        features.append({
            "type": "Feature",
            "properties": {
                "id": eid,
                "name": name,
                "type": "excavator",
                "block_id": blk,
                "copper_grade": grade,
                "bucket_capacity_m3": 15.0,
                "elevation": coords[2]
            },
            "geometry": {
                "type": "Point",
                "coordinates": coords
            }
        })

    # 5. Pit Bench Contours (Polygon boundaries for 3D visualizer)
    benches = [
        (460, 0.007, 0.005, "#3d4b66", "Поверхность карьера (+460м)"),
        (420, 0.006, 0.0045, "#4a5d80", "Горизонт разработки (+420м)"),
        (380, 0.005, 0.004, "#5a7099", "Горизонт разработки (+380м)"),
        (340, 0.004, 0.0035, "#6884b3", "Горизонт разработки (+340м)"),
        (300, 0.003, 0.0028, "#799acd", "Горизонт разработки (+300м)"),
        (260, 0.002, 0.002, "#8fb2e6", "Дно карьера (+260м)")
    ]

    center_lon, center_lat = 76.9230, 43.2260
    for elev, rx, ry, color, name in benches:
        pts = []
        steps = 32
        for i in range(steps + 1):
            angle = 2 * math.pi * i / steps
            px = center_lon + rx * math.cos(angle)
            py = center_lat + ry * math.sin(angle)
            pts.append([round(px, 6), round(py, 6), elev])
        features.append({
            "type": "Feature",
            "properties": {
                "name": name,
                "type": "bench_contour",
                "elevation": elev,
                "color": color
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [pts]
            }
        })

    # 6. Haul Road Network (3D Segments with distance, grade % and speed limit)
    # Graph edges connecting Crusher <-> Junctions <-> Excavator faces
    routes = [
        # Crusher to Surface Main Junction
        {
            "id": "road-crusher-junc",
            "name": "Подъезд к дробилке",
            "from": "crusher-01",
            "to": "junc-surface",
            "gradient_pct": 1.5,
            "max_speed_kmh": 40.0,
            "length_m": 350.0,
            "coords": [[76.9250, 43.2350, 460.0], [76.9240, 43.2330, 458.0], [76.9230, 43.2320, 455.0]]
        },
        # Main Haul Ramp 1 (Surface 455m -> Horizon 420m) - Grade 8.5%
        {
            "id": "road-ramp-420",
            "name": "Главный съезд (455м -> 420м)",
            "from": "junc-surface",
            "to": "junc-420",
            "gradient_pct": 8.5,
            "max_speed_kmh": 35.0,
            "length_m": 420.0,
            "is_main_ramp": True,
            "coords": [[76.9230, 43.2320, 455.0], [76.9215, 43.2315, 438.0], [76.9205, 43.2310, 420.0]]
        },
        # Spur to EX-01
        {
            "id": "road-spur-ex01",
            "name": "Забойный заезд ЭКГ-01 (420м)",
            "from": "junc-420",
            "to": "excavator-01",
            "gradient_pct": 0.5,
            "max_speed_kmh": 25.0,
            "length_m": 120.0,
            "coords": [[76.9205, 43.2310, 420.0], [76.9200, 43.2300, 420.0]]
        },
        # Haul Ramp 2 (Horizon 420m -> Horizon 380m) - Grade 9.0%
        {
            "id": "road-ramp-380",
            "name": "Внутрикарьерный съезд (420м -> 380м)",
            "from": "junc-420",
            "to": "junc-380",
            "gradient_pct": 9.0,
            "max_speed_kmh": 32.0,
            "length_m": 460.0,
            "is_main_ramp": True,
            "coords": [[76.9205, 43.2310, 420.0], [76.9210, 43.2285, 400.0], [76.9215, 43.2270, 380.0]]
        },
        # Spur to EX-02
        {
            "id": "road-spur-ex02",
            "name": "Забойный заезд ЭКГ-02 (380м)",
            "from": "junc-380",
            "to": "excavator-02",
            "gradient_pct": 1.0,
            "max_speed_kmh": 25.0,
            "length_m": 140.0,
            "coords": [[76.9215, 43.2270, 380.0], [76.9220, 43.2260, 380.0]]
        },
        # Haul Ramp 3 (Horizon 380m -> Horizon 340m) - Grade 8.8%
        {
            "id": "road-ramp-340",
            "name": "Внутрикарьерный съезд (380м -> 340м)",
            "from": "junc-380",
            "to": "junc-340",
            "gradient_pct": 8.8,
            "max_speed_kmh": 30.0,
            "length_m": 480.0,
            "is_main_ramp": True,
            "coords": [[76.9215, 43.2270, 380.0], [76.9230, 43.2245, 360.0], [76.9245, 43.2230, 340.0]]
        },
        # Spur to EX-03
        {
            "id": "road-spur-ex03",
            "name": "Забойный заезд ЭКГ-03 (340м)",
            "from": "junc-340",
            "to": "excavator-03",
            "gradient_pct": 0.5,
            "max_speed_kmh": 25.0,
            "length_m": 110.0,
            "coords": [[76.9245, 43.2230, 340.0], [76.9250, 43.2220, 340.0]]
        },
        # Haul Ramp 4 (Horizon 340m -> Horizon 300m) - Grade 9.2%
        {
            "id": "road-ramp-300",
            "name": "Внутрикарьерный съезд (340м -> 300м)",
            "from": "junc-340",
            "to": "junc-300",
            "gradient_pct": 9.2,
            "max_speed_kmh": 28.0,
            "length_m": 450.0,
            "is_main_ramp": True,
            "coords": [[76.9245, 43.2230, 340.0], [76.9260, 43.2205, 320.0], [76.9275, 43.2190, 300.0]]
        },
        # Spur to EX-04
        {
            "id": "road-spur-ex04",
            "name": "Забойный заезд ЭКГ-04 (300м)",
            "from": "junc-300",
            "to": "excavator-04",
            "gradient_pct": 0.8,
            "max_speed_kmh": 25.0,
            "length_m": 130.0,
            "coords": [[76.9275, 43.2190, 300.0], [76.9280, 43.2180, 300.0]]
        },
        # Spur from surface junc to Stockpile
        {
            "id": "road-spur-stockpile",
            "name": "Трасса на склад усреднения",
            "from": "junc-surface",
            "to": "stockpile-01",
            "gradient_pct": 1.2,
            "max_speed_kmh": 35.0,
            "length_m": 520.0,
            "coords": [[76.9230, 43.2320, 455.0], [76.9270, 43.2355, 455.0], [76.9300, 43.2380, 455.0]]
        }
    ]

    for r in routes:
        features.append({
            "type": "Feature",
            "properties": {
                "id": r["id"],
                "name": r["name"],
                "type": "haul_road",
                "from_node": r["from"],
                "to_node": r["to"],
                "gradient_pct": r["gradient_pct"],
                "max_speed_kmh": r["max_speed_kmh"],
                "length_m": r["length_m"],
                "is_main_ramp": r.get("is_main_ramp", False)
            },
            "geometry": {
                "type": "LineString",
                "coordinates": r["coords"]
            }
        })

    geojson = {
        "type": "FeatureCollection",
        "name": "OpenEgiz_OpenPit_Mine_Map",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}
        },
        "features": features
    }

    with open("data/mine_map.geojson", "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)
    print("Created data/mine_map.geojson with POIs, benches, and road network graph")

if __name__ == "__main__":
    generate_ore_blocks()
    generate_mine_map()
