"""動作確認用の合成 3D Tiles（東京駅周辺に箱の「建物」を並べた b3dm）を作る。
PLATEAU に繋がらない環境で、各エンジンのカメラと描画が揃っているかを見るための物。
東京駅の位置に赤い塔、北に青い塔を置く。"""
import json, math, struct, os, random, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/testtiles"
LNG0, LAT0 = 139.7671, 35.6812
A, E2 = 6378137.0, 6.69437999014e-3

def ecef(lng, lat, h):
    lo, la = math.radians(lng), math.radians(lat)
    n = A / math.sqrt(1 - E2 * math.sin(la) ** 2)
    return ((n + h) * math.cos(la) * math.cos(lo), (n + h) * math.cos(la) * math.sin(lo), (n * (1 - E2) + h) * math.sin(la))

def enu_basis(lng, lat):
    lo, la = math.radians(lng), math.radians(lat)
    e = (-math.sin(lo), math.cos(lo), 0)
    n = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    u = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    return e, n, u

M_LAT, M_LNG = 111320.0, 111320.0 * math.cos(math.radians(LAT0))

def box_tris(cx, cy, w, d, h):
    # 局所 ENU（m）の箱。面ごとに法線を持たせる
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
    faces = [
        ((0, 0, 1), [(x0, y0, h), (x1, y0, h), (x1, y1, h), (x0, y1, h)]),
        ((0, -1, 0), [(x0, y0, 0), (x1, y0, 0), (x1, y0, h), (x0, y0, h)]),
        ((1, 0, 0), [(x1, y0, 0), (x1, y1, 0), (x1, y1, h), (x1, y0, h)]),
        ((0, 1, 0), [(x1, y1, 0), (x0, y1, 0), (x0, y1, h), (x1, y1, h)]),
        ((-1, 0, 0), [(x0, y1, 0), (x0, y0, 0), (x0, y0, h), (x0, y1, h)]),
    ]
    out = []
    for nrm, q in faces:
        for i in (0, 1, 2, 0, 2, 3):
            out.append((q[i], nrm))
    return out

def make_b3dm(boxes, center_lng, center_lat):
    rtc = ecef(center_lng, center_lat, 0)
    e, n, u = enu_basis(center_lng, center_lat)
    pos, nor, col = [], [], []
    for (lng, lat, w, d, h, c) in boxes:
        cx, cy = (lng - center_lng) * M_LNG, (lat - center_lat) * M_LAT
        for (p, nr) in box_tris(cx, cy, w, d, h):
            X = [p[0] * e[k] + p[1] * n[k] + p[2] * u[k] for k in range(3)]
            N = [nr[0] * e[k] + nr[1] * n[k] + nr[2] * u[k] for k in range(3)]
            pos.append((X[0], X[2], -X[1]))  # glTF は y-up：ECEF (x,y,z) → (x, z, -y)
            nor.append((N[0], N[2], -N[1]))
            col.append(c)
    cnt = len(pos)
    pb = b"".join(struct.pack("<3f", *v) for v in pos)
    nb = b"".join(struct.pack("<3f", *v) for v in nor)
    cb = b"".join(struct.pack("<4f", *v, 1.0) for v in col)
    binb = pb + nb + cb
    mins = [min(v[k] for v in pos) for k in range(3)]
    maxs = [max(v[k] for v in pos) for k in range(3)]
    gltf = {
        "asset": {"version": "2.0"},
        # PLATEAU の b3dm と同じく、RTC の中心は glTF の CESIUM_RTC 拡張で持つ（Navara は feature table の RTC_CENTER を読まない）
        "extensionsUsed": ["CESIUM_RTC"], "extensions": {"CESIUM_RTC": {"center": list(rtc)}},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 1}}],
        "buffers": [{"byteLength": len(binb)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pb), "target": 34962},
            {"buffer": 0, "byteOffset": len(pb), "byteLength": len(nb), "target": 34962},
            {"buffer": 0, "byteOffset": len(pb) + len(nb), "byteLength": len(cb), "target": 34962},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": cnt, "type": "VEC3", "min": mins, "max": maxs},
            {"bufferView": 1, "componentType": 5126, "count": cnt, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": cnt, "type": "VEC4"},
        ],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    binb += b"\0" * ((4 - len(binb) % 4) % 4)
    glb_len = 12 + 8 + len(js) + 8 + len(binb)
    glb = struct.pack("<4sII", b"glTF", 2, glb_len) + struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(binb), b"BIN\0") + binb
    ft = json.dumps({"BATCH_LENGTH": 0}, separators=(",", ":")).encode()
    ft += b" " * ((8 - (28 + len(ft)) % 8) % 8)
    total = 28 + len(ft) + len(glb)
    return struct.pack("<4sIIIIII", b"b3dm", 1, total, len(ft), 0, 0, 0) + ft + glb

random.seed(1)
os.makedirs(OUT, exist_ok=True)
G, SPAN = 4, 3000.0  # 4×4 タイル・一辺 3 km
children = []
for ty in range(G):
    for tx in range(G):
        x0 = -SPAN / 2 + tx * SPAN / G; y0 = -SPAN / 2 + ty * SPAN / G
        boxes = []
        for gy in range(10):
            for gx in range(10):
                cx = x0 + (gx + 0.5) * SPAN / G / 10; cy = y0 + (gy + 0.5) * SPAN / G / 10
                if math.hypot(cx, cy) < 60: continue
                h = random.choice([15, 20, 30, 45, 60, 90, 120])
                g = 0.75 + random.random() * 0.2
                boxes.append((LNG0 + cx / M_LNG, LAT0 + cy / M_LAT, 40, 40, h, (g, g, g)))
        if tx == G // 2 and ty == G // 2:
            boxes.append((LNG0, LAT0, 30, 30, 250, (0.9, 0.1, 0.1)))  # 東京駅＝赤い塔
        if tx == G // 2 and ty == G - 1:
            boxes.append((LNG0, LAT0 + 1200 / M_LAT, 30, 30, 200, (0.1, 0.3, 0.9)))  # 北 1.2 km＝青い塔
        name = f"t{tx}_{ty}.b3dm"
        clng = LNG0 + (x0 + SPAN / G / 2) / M_LNG; clat = LAT0 + (y0 + SPAN / G / 2) / M_LAT
        open(os.path.join(OUT, name), "wb").write(make_b3dm(boxes, clng, clat))
        w = (SPAN / G / 2 + 50) / M_LNG; hlat = (SPAN / G / 2 + 50) / M_LAT
        region = [math.radians(clng - w), math.radians(clat - hlat), math.radians(clng + w), math.radians(clat + hlat), 0, 260]
        children.append({"boundingVolume": {"region": region}, "geometricError": 0, "content": {"uri": name}})
w = (SPAN / 2 + 100) / M_LNG; hl = (SPAN / 2 + 100) / M_LAT
ts = {"asset": {"version": "1.0"}, "geometricError": 2000,
      "root": {"boundingVolume": {"region": [math.radians(LNG0 - w), math.radians(LAT0 - hl), math.radians(LNG0 + w), math.radians(LAT0 + hl), 0, 260]},
               "geometricError": 300, "refine": "ADD", "children": children}}
json.dump(ts, open(os.path.join(OUT, "tileset.json"), "w"))
print("wrote", OUT, len(children), "tiles")
