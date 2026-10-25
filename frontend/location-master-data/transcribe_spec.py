#!/usr/bin/env python3
"""Transcribe §4 of the Banaadir location specification into source/spec_section4.json.

The specification (taken from the LRMIS Location Settings module on 2026-10-25)
is plain text with a fixed line pattern, so it is parsed rather than retyped.
Every value is copied verbatim; nothing is corrected here. Corrections and flags
are applied by build.py and listed in CHANGELOG.md.

Usage: python3 transcribe_spec.py <path to banaadir-location-spec.md>
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

DISTRICT = re.compile(r"^4\.(\d+) (.+?) — district code (\d+)$")
DIST_COORD = re.compile(r"^\* District coordinate: ([\d.]+), ([\d.]+) \((\w+); (.+)\)$")
DIST_TOTALS = re.compile(r"^\* (\d+) sections · (\d+) sectors · (\d+) neighborhoods$")
SECTION = re.compile(
    r"^Section (\d+) · (.+?) \(location code `([^`]+)`\) — "
    r"(?:placeholder = district centre \[placeholder\]|"
    r"([\d.]+), ([\d.]+) \[(\w+)\] source: (.+))$"
)
SECTOR = re.compile(
    r"^\* Sector (\d+) · (.+?) — "
    r"(?:(\d+) neighborhoods \(`([^`]+)`–`([^`]+)`\)|no neighborhoods registered)"
    r"(?: — note: (.+))?$"
)


def parse(text):
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.strip() == "4. Location master data")
    end = next(i for i, l in enumerate(lines) if l.startswith("5. Records outside"))
    districts = []
    for raw in lines[start + 1:end]:
        line = raw.strip()
        if not line:
            continue
        if m := DISTRICT.match(line):
            districts.append({
                "spec_ref": f"4.{m[1]}", "district_name": m[2], "district_code": m[3],
                "sections": [],
            })
        elif m := DIST_COORD.match(line):
            d = districts[-1]
            d.update(lat=float(m[1]), lon=float(m[2]), coord_confidence=m[3], coord_source=m[4])
        elif m := DIST_TOTALS.match(line):
            districts[-1]["stated_totals"] = {
                "sections": int(m[1]), "sectors": int(m[2]), "neighborhoods": int(m[3]),
            }
        elif m := SECTION.match(line):
            s = {"section_code": m[1], "section_name": m[2], "location_code": m[3], "sectors": []}
            if m[4]:
                s.update(lat=float(m[4]), lon=float(m[5]), coord_confidence=m[6], coord_source=m[7])
            else:
                s.update(lat=None, lon=None, coord_confidence="placeholder",
                         coord_source="placeholder = district centre")
            districts[-1]["sections"].append(s)
        elif m := SECTOR.match(line):
            districts[-1]["sections"][-1]["sectors"].append({
                "sector_code": m[1], "sector_name": m[2],
                "neighborhood_count": int(m[3]) if m[3] else 0,
                "first_code": m[4], "last_code": m[5], "note": m[6],
            })
        else:
            raise ValueError(f"Unparsed line in §4: {raw!r}")
    return districts


def main():
    spec = Path(sys.argv[1])
    districts = parse(spec.read_text(encoding="utf-8"))
    out = HERE / "source" / "spec_section4.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({
        "source": "LRMIS Location Settings, exported 2026-10-25 (specification §4)",
        "region_name_as_stored": ["Benaadir", "Banaadir"],
        "districts": districts,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n_sec = sum(len(d["sections"]) for d in districts)
    n_sct = sum(len(s["sectors"]) for d in districts for s in d["sections"])
    print(f"wrote {out}: {len(districts)} districts, {n_sec} sections, {n_sct} sectors")


if __name__ == "__main__":
    main()
