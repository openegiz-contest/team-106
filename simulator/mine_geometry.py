"""
Единая геометрия карьера (single source of truth).

Используется:
  * симулятором (dispatcher.py) — самосвалы едут по реальной полилинии
    «забой -> заезд на уступ -> спиральный съезд -> борт -> дробилка»,
    длина и уклон рейса берутся из этой геометрии;
  * API /api/map — визуализатор строит 3D-сцену из тех же данных;
  * scripts/build_data.py — генерирует data/mine_map.geojson и координаты блоков.

Локальная система координат: метры, x — на восток, y — на север, z — абсолютная
отметка (м). Центр карьера привязан к (CENTER_LON, CENTER_LAT).
"""
import math
from functools import lru_cache
from typing import Dict, List, Tuple

CENTER_LON = 76.9230
CENTER_LAT = 43.2260
M_PER_DEG_LAT = 111_132.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(CENTER_LAT))

# Карьер слегка вытянут с запада на восток (по простиранию рудного тела)
SX, SY = 1.15, 0.90

# Уступы: отметка, радиус подошвы (внешний край площадки), радиус бровки (внутренний край)
BENCHES: List[dict] = [
    {"elev": 460.0, "toe": None, "crest": 580.0, "name": "Поверхность (+460 м)"},
    {"elev": 420.0, "toe": 540.0, "crest": 470.0, "name": "Горизонт +420 м"},
    {"elev": 380.0, "toe": 430.0, "crest": 360.0, "name": "Горизонт +380 м"},
    {"elev": 340.0, "toe": 320.0, "crest": 250.0, "name": "Горизонт +340 м"},
    {"elev": 300.0, "toe": 210.0, "crest": 140.0, "name": "Горизонт +300 м"},
    {"elev": 260.0, "toe": 100.0, "crest": 0.0, "name": "Дно карьера (+260 м)"},
]
BENCH_INDEX = {int(b["elev"]): i for i, b in enumerate(BENCHES)}

THETA_RAMP_TOP = math.pi / 2       # съезд начинается на северном борту
RAMP_TARGET_GRADE = 0.09           # 9 % — проектный уклон съезда
FLOOR_LINK_DTHETA = 0.22           # переход съезда через площадку уступа

# Экскаваторы: уступ и угловое смещение забоя от точки примыкания съезда (рад, против часовой)
EXCAVATOR_LAYOUT = {
    "excavator-01": {"elev": 420.0, "offset": 0.95},
    "excavator-02": {"elev": 380.0, "offset": 1.25},
    "excavator-03": {"elev": 340.0, "offset": 1.55},
    "excavator-04": {"elev": 300.0, "offset": 1.90},
}

# Рудные блоки: уступ + угол (рад, относительно точки примыкания) + угловая ширина сектора
BLOCK_LAYOUT = {
    "block-01": {"elev": 420.0, "offset": 0.95, "width": 0.55},
    "block-02": {"elev": 420.0, "offset": 3.60, "width": 1.10},
    "block-03": {"elev": 380.0, "offset": 1.25, "width": 0.60},
    "block-04": {"elev": 380.0, "offset": 3.90, "width": 1.30},
    "block-05": {"elev": 340.0, "offset": 1.55, "width": 0.80},
    "block-06": {"elev": 340.0, "offset": 4.10, "width": 1.40},
    "block-07": {"elev": 300.0, "offset": 1.90, "width": 1.00},
    "block-08": {"elev": 260.0, "offset": 0.00, "width": 6.28},
}

# Объекты на поверхности (полярные координаты карьера)
FACILITY_LAYOUT = {
    "crusher-01": {"r": 760.0, "theta": math.pi / 2, "elev": 460.0},
    "stockpile-01": {"r": 800.0, "theta": math.pi / 2 - 0.45, "elev": 458.0},
    "waste-dump-01": {"r": 860.0, "theta": math.pi / 2 + 0.75, "elev": 470.0},
}


# ---------------------------------------------------------------- helpers
def polar_xy(r: float, theta: float) -> Tuple[float, float]:
    return r * SX * math.cos(theta), r * SY * math.sin(theta)


def to_lonlat(x: float, y: float) -> Tuple[float, float]:
    return CENTER_LON + x / M_PER_DEG_LON, CENTER_LAT + y / M_PER_DEG_LAT


def to_lonlat_elev(p: Tuple[float, float, float]) -> List[float]:
    lon, lat = to_lonlat(p[0], p[1])
    return [round(lon, 6), round(lat, 6), round(p[2], 1)]


def bench_mid_radius(i: int) -> float:
    b = BENCHES[i]
    return (b["toe"] + b["crest"]) / 2.0 if b["toe"] else b["crest"]


def _arc(r0: float, r1: float, th0: float, th1: float, z0: float, z1: float, n: int) -> List[Tuple[float, float, float]]:
    pts = []
    for s in range(n + 1):
        t = s / n
        r = r0 + (r1 - r0) * t
        th = th0 + (th1 - th0) * t
        x, y = polar_xy(r, th)
        pts.append((x, y, z0 + (z1 - z0) * t))
    return pts


def _length(pts: List[Tuple[float, float, float]]) -> float:
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


# ---------------------------------------------------------------- ramp
@lru_cache(maxsize=1)
def build_ramp() -> dict:
    """
    Главный спиральный съезд от дробилки до дна карьера.
    Возвращает полилинию (локальные метры) и индексы точек примыкания каждого уступа.
    """
    cr = FACILITY_LAYOUT["crusher-01"]
    pts: List[Tuple[float, float, float]] = []
    seg_types: List[str] = []  # тип сегмента i -> (pts[i], pts[i+1])

    # 1. Поверхностная трасса: дробилка -> бровка борта
    surf = _arc(cr["r"], BENCHES[0]["crest"], cr["theta"], THETA_RAMP_TOP, 460.0, 460.0, 6)
    pts.extend(surf)
    seg_types.extend(["surface"] * (len(surf) - 1))

    junctions: Dict[int, dict] = {}
    theta = THETA_RAMP_TOP
    for k in range(len(BENCHES) - 1):
        upper, lower = BENCHES[k], BENCHES[k + 1]
        r0, r1 = upper["crest"], lower["toe"]
        drop = upper["elev"] - lower["elev"]
        r_avg = (r0 + r1) / 2.0
        arc_scale = (SX + SY) / 2.0
        dtheta = (drop / RAMP_TARGET_GRADE) / (r_avg * arc_scale)
        dtheta = max(0.7, min(dtheta, 3.4))

        wall = _arc(r0, r1, theta, theta - dtheta, upper["elev"], lower["elev"], 28)
        pts.extend(wall[1:])
        seg_types.extend(["ramp"] * (len(wall) - 1))
        theta -= dtheta

        if lower["crest"] > 0:
            # переход через площадку уступа к бровке следующего борта
            half = FLOOR_LINK_DTHETA / 2
            link1 = _arc(lower["toe"], bench_mid_radius(k + 1), theta, theta - half, lower["elev"], lower["elev"], 3)
            pts.extend(link1[1:])
            seg_types.extend(["bench"] * (len(link1) - 1))
            junctions[int(lower["elev"])] = {"index": len(pts) - 1, "theta": theta - half}
            link2 = _arc(bench_mid_radius(k + 1), lower["crest"], theta - half, theta - FLOOR_LINK_DTHETA,
                         lower["elev"], lower["elev"], 3)
            pts.extend(link2[1:])
            seg_types.extend(["bench"] * (len(link2) - 1))
            theta -= FLOOR_LINK_DTHETA
        else:
            junctions[int(lower["elev"])] = {"index": len(pts) - 1, "theta": theta}

    return {"points": pts, "segment_types": seg_types, "junctions": junctions}


# ---------------------------------------------------------------- positions
def excavator_theta(exc_id: str) -> float:
    lay = EXCAVATOR_LAYOUT[exc_id]
    j = build_ramp()["junctions"][int(lay["elev"])]
    return j["theta"] + lay["offset"]


def excavator_local(exc_id: str) -> Tuple[float, float, float]:
    lay = EXCAVATOR_LAYOUT[exc_id]
    i = BENCH_INDEX[int(lay["elev"])]
    x, y = polar_xy(bench_mid_radius(i), excavator_theta(exc_id))
    return x, y, lay["elev"]


def excavator_lonlat(exc_id: str) -> List[float]:
    return to_lonlat_elev(excavator_local(exc_id))


def block_sector(block_id: str) -> dict:
    lay = BLOCK_LAYOUT[block_id]
    elev = int(lay["elev"])
    i = BENCH_INDEX[elev]
    b = BENCHES[i]
    j = build_ramp()["junctions"][elev]
    th_c = j["theta"] + lay["offset"]
    return {
        "elev": lay["elev"],
        "r_inner": b["crest"],
        "r_outer": b["toe"],
        "theta_start": th_c - lay["width"] / 2,
        "theta_end": th_c + lay["width"] / 2,
        "theta_center": th_c,
    }


def block_lonlat(block_id: str) -> List[float]:
    s = block_sector(block_id)
    i = BENCH_INDEX[int(s["elev"])]
    r = bench_mid_radius(i) if BENCHES[i]["toe"] and BENCHES[i]["crest"] > 0 else 0.0
    x, y = polar_xy(r, s["theta_center"])
    return to_lonlat_elev((x, y, s["elev"]))


def facility_local(fid: str) -> Tuple[float, float, float]:
    f = FACILITY_LAYOUT[fid]
    x, y = polar_xy(f["r"], f["theta"])
    return x, y, f["elev"]


def facility_lonlat(fid: str) -> List[float]:
    return to_lonlat_elev(facility_local(fid))


# ---------------------------------------------------------------- haul routes
class HaulRoute:
    """Полилиния рейса: progress 0.0 = забой экскаватора, 1.0 = приёмный бункер дробилки."""

    def __init__(self, exc_id: str, points: List[Tuple[float, float, float]], seg_types: List[str]):
        self.exc_id = exc_id
        self.points = points
        self.seg_types = seg_types
        self.cum = [0.0]
        for i in range(len(points) - 1):
            self.cum.append(self.cum[-1] + math.dist(points[i], points[i + 1]))
        self.length_m = self.cum[-1]

    def _locate(self, progress: float) -> Tuple[int, float]:
        s = max(0.0, min(1.0, progress)) * self.length_m
        lo, hi = 0, len(self.cum) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if self.cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        seg_len = self.cum[lo + 1] - self.cum[lo]
        t = 0.0 if seg_len <= 0 else (s - self.cum[lo]) / seg_len
        return lo, t

    def point_at(self, progress: float) -> Tuple[float, float, float]:
        i, t = self._locate(progress)
        a, b = self.points[i], self.points[i + 1]
        return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))

    def lonlat_at(self, progress: float) -> List[float]:
        return to_lonlat_elev(self.point_at(progress))

    def grade_pct_at(self, progress: float) -> float:
        """Уклон по направлению к дробилке (+ = подъём), %"""
        i, _ = self._locate(progress)
        a, b = self.points[i], self.points[i + 1]
        horiz = math.hypot(b[0] - a[0], b[1] - a[1])
        return 0.0 if horiz <= 1e-6 else (b[2] - a[2]) / horiz * 100.0

    def segment_type_at(self, progress: float) -> str:
        i, _ = self._locate(progress)
        return self.seg_types[i]

    def to_dict(self) -> dict:
        return {
            "excavator_id": self.exc_id,
            "length_m": round(self.length_m, 1),
            "points": [[round(p[0], 1), round(p[1], 1), round(p[2], 1)] for p in self.points],
        }


@lru_cache(maxsize=None)
def haul_route(exc_id: str) -> HaulRoute:
    ramp = build_ramp()
    lay = EXCAVATOR_LAYOUT[exc_id]
    elev = int(lay["elev"])
    j = ramp["junctions"][elev]
    i_bench = BENCH_INDEX[elev]
    r_mid = bench_mid_radius(i_bench)

    # Забойная дорога: экскаватор -> точка примыкания (по средней линии площадки)
    th_exc = j["theta"] + lay["offset"]
    n = max(4, int(abs(lay["offset"]) * 12))
    bench_road = _arc(r_mid, r_mid, th_exc, j["theta"], lay["elev"], lay["elev"], n)

    # Съезд от точки примыкания вверх до дробилки (обратный порядок)
    up = list(reversed(ramp["points"][: j["index"] + 1]))
    up_types = list(reversed(ramp["segment_types"][: j["index"]]))

    points = bench_road + up[1:]
    seg_types = ["bench"] * (len(bench_road) - 1) + up_types
    return HaulRoute(exc_id, points, seg_types)


def map_payload() -> dict:
    """Компактное описание геометрии для визуализатора (/api/map)."""
    ramp = build_ramp()
    return {
        "center": {"lon": CENTER_LON, "lat": CENTER_LAT},
        "ellipse": {"sx": SX, "sy": SY},
        "benches": BENCHES,
        "ramp": [[round(p[0], 1), round(p[1], 1), round(p[2], 1)] for p in ramp["points"]],
        "junctions": {str(k): {"theta": v["theta"]} for k, v in ramp["junctions"].items()},
        "excavators": {
            eid: {"local": [round(c, 1) for c in excavator_local(eid)], "theta": excavator_theta(eid)}
            for eid in EXCAVATOR_LAYOUT
        },
        "blocks": {bid: block_sector(bid) for bid in BLOCK_LAYOUT},
        "facilities": {fid: [round(c, 1) for c in facility_local(fid)] for fid in FACILITY_LAYOUT},
        "routes": {eid: haul_route(eid).to_dict() for eid in EXCAVATOR_LAYOUT},
    }


if __name__ == "__main__":
    for eid in EXCAVATOR_LAYOUT:
        r = haul_route(eid)
        print(eid, "route %.0f m" % r.length_m, "exc at", excavator_lonlat(eid))
