#!/usr/bin/env python3
"""Build banaadir_locations.csv and banaadir_locations.geojson.

Inputs (in ./source):
  spec_section4.json  §4 of the specification, transcribed verbatim (transcribe_spec.py)
  corrections.json    region spelling, verified coordinate updates, alt_name values

The build checks the totals against the specification and fails if they differ.
Run: python3 build.py
"""
import csv
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPECTED = {"districts": 20, "sections": 94, "sectors": 395, "neighborhoods": 5364}
BBOX = {"lat": (1.95, 2.20), "lon": (45.15, 45.50)}
COLUMNS = [
    "region", "district_code", "district_name", "section_code", "section_name",
    "location_code", "sector_code", "sector_name", "neighborhood_count",
    "neighborhood_code_prefix", "lat", "lon", "coord_level", "coord_confidence",
    "coord_source", "alt_name",
]


def load():
    spec = json.loads((HERE / "source" / "spec_section4.json").read_text(encoding="utf-8"))
    fixes = json.loads((HERE / "source" / "corrections.json").read_text(encoding="utf-8"))
    return spec["districts"], fixes


def build_rows(districts, fixes):
    region = fixes["region"]["name"]
    updates = fixes["coordinate_updates"]
    alt = fixes["name_alt_names"]
    rows = []
    for d in districts:
        abbr = next(s["location_code"][:2] for s in d["sections"] if s["location_code"] != "n/a")
        base = {"region": region, "district_code": d["district_code"], "district_name": d["district_name"]}
        d_count = sum(t["neighborhood_count"] for s in d["sections"] for t in s["sectors"])
        rows.append({
            **base, "section_code": "", "section_name": "", "location_code": "",
            "sector_code": "", "sector_name": "", "neighborhood_count": d_count,
            "neighborhood_code_prefix": abbr, "lat": d["lat"], "lon": d["lon"],
            "coord_level": "district", "coord_confidence": d["coord_confidence"],
            "coord_source": d["coord_source"],
            "alt_name": fixes["district_alt_names"].get(d["district_code"], ""),
        })
        for s in d["sections"]:
            # "n/a" in the spec means the section has no location code in the system.
            loc = "" if s["location_code"] == "n/a" else s["location_code"]
            if s["lat"] is None:
                lat, lon = d["lat"], d["lon"]
                conf, src = "placeholder", "placeholder = district centre (no reliable match found)"
            else:
                lat, lon, conf, src = s["lat"], s["lon"], s["coord_confidence"], s["coord_source"]
            if loc in updates:
                u = updates[loc]
                lat, lon, conf, src = u["lat"], u["lon"], u["coord_confidence"], u["coord_source"]
            sec = {**base, "section_code": s["section_code"], "section_name": s["section_name"],
                   "location_code": loc}
            rows.append({
                **sec, "sector_code": "", "sector_name": "",
                "neighborhood_count": sum(t["neighborhood_count"] for t in s["sectors"]),
                "neighborhood_code_prefix": loc, "lat": lat, "lon": lon,
                "coord_level": "section", "coord_confidence": conf, "coord_source": src,
                "alt_name": alt.get(s["section_name"], ""),
            })
            for t in s["sectors"]:
                key = loc + t["sector_code"]
                if loc and key in updates:
                    u = updates[key]
                    t_lat, t_lon, t_conf, t_src = u["lat"], u["lon"], u["coord_confidence"], u["coord_source"]
                else:
                    t_lat, t_lon, t_conf = lat, lon, "inherited"
                    t_src = f"inherited from section {loc or s['section_name']} ({conf})"
                rows.append({
                    **sec, "sector_code": t["sector_code"], "sector_name": t["sector_name"],
                    "neighborhood_count": t["neighborhood_count"],
                    "neighborhood_code_prefix": (t["first_code"] or "")[:-2],
                    "lat": t_lat, "lon": t_lon, "coord_level": "sector",
                    "coord_confidence": t_conf, "coord_source": t_src,
                    "alt_name": alt.get(t["sector_name"], ""),
                })
    for r in rows:
        r["lat"], r["lon"] = round(r["lat"], 5), round(r["lon"], 5)
    return rows


def feature_ids(rows):
    """Stable ids: district code, then .section, then .sector; the prefix breaks duplicate sector codes."""
    keys = [".".join(x for x in (r["district_code"], r["section_code"], r["sector_code"]) if x) for r in rows]
    dup = {k for k, n in Counter(keys).items() if n > 1}
    return [f"{k}.{r['neighborhood_code_prefix']}" if k in dup else k for k, r in zip(keys, rows)]


def check(districts, rows):
    errors, warnings = [], []
    levels = Counter(r["coord_level"] for r in rows)
    got = {
        "districts": levels["district"], "sections": levels["section"], "sectors": levels["sector"],
        "neighborhoods": sum(r["neighborhood_count"] for r in rows if r["coord_level"] == "sector"),
    }
    for k, v in EXPECTED.items():
        if got[k] != v:
            errors.append(f"total {k}: built {got[k]}, spec says {v}")
    for d in districts:
        st = d["stated_totals"]
        n = (len(d["sections"]), sum(len(s["sectors"]) for s in d["sections"]),
             sum(t["neighborhood_count"] for s in d["sections"] for t in s["sectors"]))
        if n != (st["sections"], st["sectors"], st["neighborhoods"]):
            errors.append(f"{d['district_name']}: built {n}, spec header says {st}")
    for r in rows:
        if not (BBOX["lat"][0] <= r["lat"] <= BBOX["lat"][1] and BBOX["lon"][0] <= r["lon"] <= BBOX["lon"][1]):
            errors.append(f"outside Banaadir bbox: {r['coord_level']} {r['location_code']} {r['lat']},{r['lon']}")
        if r["coord_level"] == "sector":
            if not r["neighborhood_code_prefix"]:
                warnings.append(f"no neighborhoods: {r['district_name']} › {r['section_name']} › {r['sector_name']}")
            elif not r["location_code"] or not r["neighborhood_code_prefix"].startswith(r["location_code"]):
                warnings.append(f"prefix {r['neighborhood_code_prefix']} does not start with the section's "
                                f"location code ({r['location_code'] or 'none'}): {r['section_name']} › {r['sector_name']}")
    locs = Counter(r["location_code"] for r in rows if r["coord_level"] == "section" and r["location_code"])
    for k, n in locs.items():
        if n > 1:
            errors.append(f"location code {k} used by {n} sections")
    sectors = Counter((r["location_code"] or r["section_name"], r["district_code"], r["sector_code"])
                      for r in rows if r["coord_level"] == "sector")
    for (sec, _, code), n in sectors.items():
        if n > 1:
            warnings.append(f"sector code {code} used {n} times in section {sec}")
    return got, errors, warnings


def write(rows, ids):
    with open(HERE / "banaadir_locations.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows({**r, "lat": f"{r['lat']:.5f}", "lon": f"{r['lon']:.5f}"} for r in rows)
    fc = {
        "type": "FeatureCollection",
        "name": "banaadir_locations",
        "features": [{
            "type": "Feature", "id": i,
            "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
            "properties": {c: r[c] for c in COLUMNS},
        } for i, r in zip(ids, rows)],
    }
    (HERE / "banaadir_locations.geojson").write_text(
        json.dumps(fc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def verify_outputs():
    """Re-read both files and confirm they hold the same records."""
    with open(HERE / "banaadir_locations.csv", encoding="utf-8") as f:
        csv_rows = list(csv.DictReader(f))
    gj = json.loads((HERE / "banaadir_locations.geojson").read_text(encoding="utf-8"))["features"]
    assert len(csv_rows) == len(gj), "CSV and GeoJSON row counts differ"
    for c, g in zip(csv_rows, gj):
        p = {k: (f"{v:.5f}" if k in ("lat", "lon") else str(v)) for k, v in g["properties"].items()}
        assert p == c, f"CSV/GeoJSON mismatch at {g['id']}"
        assert g["geometry"]["coordinates"] == [g["properties"]["lon"], g["properties"]["lat"]]
    return len(csv_rows)


def main():
    districts, fixes = load()
    rows = build_rows(districts, fixes)
    got, errors, warnings = check(districts, rows)
    print("totals:", ", ".join(f"{k} {v} (spec {EXPECTED[k]})" for k, v in got.items()))
    print("confidence by level:")
    for lvl in ("district", "section", "sector"):
        c = Counter(r["coord_confidence"] for r in rows if r["coord_level"] == lvl)
        print(f"  {lvl}: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())))
    for w in warnings:
        print("warning:", w)
    if errors:
        for e in errors:
            print("ERROR:", e)
        sys.exit(1)
    write(rows, feature_ids(rows))
    print(f"wrote banaadir_locations.csv and banaadir_locations.geojson ({verify_outputs()} records, identical)")


if __name__ == "__main__":
    main()
