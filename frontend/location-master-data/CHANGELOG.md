# Banaadir location master data: change log

Source: the LRMIS Location Settings export of 25 October 2026 (specification §4). It is treated as a standalone dataset. Its district codes are the client LRMIS codes, which differ from the app's Supabase `districts` table (for example, Kaaraan is 17 here and 34 in the app). Nothing here is imported into the database.

## Files

| File | What it is |
|---|---|
| `banaadir_locations.csv` | 509 rows: 20 districts, 94 sections and 395 sectors, one row each (`coord_level` tells them apart). |
| `banaadir_locations.geojson` | The same 509 records as Point features. Properties equal the CSV columns. Feature `id` = `district.section.sector`. |
| `source/spec_section4.json` | §4 transcribed verbatim by `transcribe_spec.py`, which parses the spec, so nothing was retyped. |
| `source/corrections.json` | Every change applied on top of §4: region spelling, verified coordinates, `alt_name` values. |
| `source/osm_checks.json` | OSM evidence for the verified points, plus the result of testing each point against the OSM district boundaries. |
| `build.py` | Builds both outputs, checks the totals, the bounding box, and that CSV and GeoJSON are identical. |

To rebuild, run `python3 build.py` (and `python3 transcribe_spec.py <spec.md>` first if the spec changes).

## Totals check

| | Spec | Built |
|---|---|---|
| Districts | 20 | 20 |
| Sections | 94 | 94 |
| Sectors | 395 | 395 |
| Neighborhoods mapped to active sectors | 5,364 | 5,364 |

All 20 per-district headers (sections · sectors · neighborhoods) also match the sum of their rows. No mismatches.

The 275 neighborhood records outside the active list also reconcile with the spec's total of 5,639: 5,364 + 32 (DYRW) + 16 (GBCE) + 4 (GBGB) + 67 (Ceelmareer) + 57 (Ceel Turcaaye) + 86 (Warshiikh) + 5 (Barwaaqo) + 4 (Afaraad) + 3 (Saddexaad) + 1 (Head Office test) = 5,639.

## Conventions

- `neighborhood_count` is the number of records, not the highest block number. Where numbering has gaps, the two differ (see §6.10 below).
- `neighborhood_code_prefix` is the district abbreviation on district rows, the location code on section rows, and the 6-letter code prefix on sector rows (for example `DYCCJD`).
- `coord_confidence` is `high`, `medium`, `low` or `placeholder` (= district centre repeated; treat as unknown). It is `inherited` on a sector row that repeats its section's point; `coord_source` then names the section and that section's confidence.
- Names are kept exactly as §4 stores them. The system's suffixes ("Horseed YQ", "Iftin HLBW") are already removed in §4, and this dataset follows §4. `alt_name` holds English names and the majority spelling of a name.
- Head Office (district code 29) and its "TEST-CLAUDE …" section, sector and neighborhood (code 9901) are left out (§5).

## §6 issues

### 6.1 Region spelling: resolved
- `region`: "Benaadir" (19 districts) → **"Banaadir"**. Boondheere is unchanged ("Banaadir").
- Reason: "Banaadir" is the spelling of the Banaadir Regional Administration itself and of the OSM `name:so` for the region (relation 14278313).
- **Client action:** fix the 19 district records in the LRMIS.

### 6.2 Section "Rati Weyne DY" (DYRW): confirmed, left out
- It is not in the active Section list, so it is not in the dataset, along with its 4 sectors and 32 neighborhoods.
- Note: Dayniile › Ciise Cabdi › sector 05 "Rati Weyne" (DYCCRW, 20 neighborhoods) and Daarusalaam › section "Ratiweyne" (DSRW) share the name. Daarusalaam was split from Dayniile in 2022, so DYRW may have moved.
- **Client decision:** reactivate DYRW, or retire it and reassign its 32 neighborhoods.

### 6.3 Garasbaalleey groups GBCE (16) and GBGB (4): confirmed, left out
- No active section carries either code.
- **Client decision:** say which sections they belong to. Note that Dayniile has an active section "Garas Baalleey" (DYGB).

### 6.4 Neighborhoods on inactive sectors: confirmed, left out
- Kowda Luulyo DS › "Ceelmareer": 67 neighborhoods, numbered 80–146.
- Kowda Luulyo DS › "Ceel Turcaaye": 57 neighborhoods.
- Nageyle KR › "Warshiikh": 86 neighborhoods.
- Xamarbile WR › "Barwaaqo": 5 neighborhoods.
- Bandar Wanaag HL › "Afaraad" (4) and "Saddexaad" (3). The active sectors of Bandar Wanaag are named sectors 01–05, not ordinals.

Observation: the active sector Kowda Luulyo › Cali Turcaaye (DSKLCT) has 22 records numbered 1–79 non-contiguously, and 22 + 57 = 79. "Ceel Turcaaye" is probably the rest of the Cali Turcaaye series. "Ceelmareer" (80–146) continues the same numbering. No merge was made.

**Client decision:** reassign each group to an active sector, or retire it.

### 6.5 Lebiga DS: confirmed, kept as stored
- `location_code`: "n/a" → empty. The section has no location code in the system; none was invented.
- Sector Dibida keeps the prefix `DSTKDB` (its 20 records really are coded `DSTKDB01–20`, under Tawakal DS). `build.py` warns about it on every run.
- Buulo Barreey, Ceel Cirfiid and Xaanshooleey are kept with `neighborhood_count` 0 and an empty prefix.
- **Client decision:** give Lebiga a location code and re-code DSTKDB01–20 under it.

### 6.6 Sector "Siinka Dheer" without a suffix: could not confirm
- §4 has no sector with this name. Section Siinka Dheer (KXSD) has the sectors Albirri, Alfaraj and Midnimo.
- The record is probably outside the active Sector list, so it is not in this dataset.
- **Client action:** check the record.

### 6.7 "Janaraal Daa" (Hodan › Axmed Gurey › sector 02): flagged, kept as stored
- `alt_name` = "Janaraal Daa'uud (probably truncated)".
- Its neighborhood code `HDAGJD` fits "Janaraal Daa'uud", but the name was not changed.
- **Client action:** confirm, and correct it in the LRMIS.

### 6.8 Weydoow GB has two sectors coded 03: confirmed, kept as stored
- Buulo Cadaab (`GBWYBC`) and Macaanteey (`GBWYMT`) both keep code 03. Renumbering would invent a code.
- Their GeoJSON ids are `32.06.03.GBWYBC` and `32.06.03.GBWYMT`. `build.py` warns about the duplicate.
- **Client decision:** renumber one of them; 04 is free.

### 6.9 Neighborhood code typos: confirmed, fix in the LRMIS
These are individual neighborhood records, which this dataset doesn't hold. The sector prefixes come from §4 and are already correct, so the output needs no change:

- `DKKDSD…` → `DKKGSD…` (Kaawo Godeey › Saddexaad)
- `KXFC…` → `KXCF…` (Cumar Fiyaasko)
- `WBMHAW…` → `WDMHAW…` (Maxamuud Hilowle › Axmed Waayeel; WB is Waaberi, the section is in Wadajir)
- `" DYKDHD22"` → `"DYKDHD22"` (trim the leading space)
- `KRWJCC17B` and `HLCLSD` don't follow the pattern. Cabdi Cadde already has 01–38, so 17B looks like a duplicate of 17, and HLCLSD has no number.
- **Client decision:** keep, renumber or delete `KRWJCC17B` and `HLCLSD`.

The spec doesn't say how many records carry each of the first three typos.

### 6.10 Gaps in neighborhood numbering: confirmed
The counts match the gaps exactly:

| Sector | Prefix | Range | Missing | Count |
|---|---|---|---|---|
| Xannaano Bulsho › Afaraad | DKXBAF | 01–52 | 46–51 | 46 |
| Saciid Rooraaye › Koowaad | DKSRKW | 01–51 | 35–50 | 35 |
| Saciid Rooraaye › Labaad | DKSRLB | 01–30 | 26–29 | 26 |
| Kowda Luulyo › Cali Turcaaye | DSKLCT | 01–79 | non-contiguous | 22 |

Every other sector runs from 01 to its count with no gap.

### 6.11 Inconsistent spellings: kept as stored, majority spelling in `alt_name`

| As stored | Where | `alt_name` | Count |
|---|---|---|---|
| Kowaad | DYGB sector 01 | Koowaad; 1st | 1 vs 19 Koowaad |
| Axmed Gurey | sections HDAG, SBAG | Axmed Gureey | 2 vs 4 |
| Axmed gureey | XJKM sector 01 | Axmed Gureey | 1 |
| Xaawa Taako | section HWXT | Xaawo Taako | 1 vs 6 |
| Hillaac | HLBW 04, WBHR 02, YQTW 03 | Hilaac | 3 vs 4 (close; client's choice) |
| Janaraal Daauud | WRXB sector 03 | Janaraal Daa'uud | 1 vs 7 |

Ordinal sectors also get an English `alt_name`: Koowaad 1st, Labaad 2nd, Saddexaad 3rd, Afaraad 4th, Shanaad 5th.

**Client decision:** the official spelling of each name.

## Other things flagged (not in §6)

1. **More spelling pairs.** All are kept as stored:
   - Hanti Wadaag (SNJB 01) / Hantiwadaag (3×); this one has an `alt_name`.
   - 26 Juun (XJJD 01) / 26ka Juun (WBHW 03)
   - Sinaay (section BDSY) / Siinaay (WRJD 05)
   - Waxaracadde (section HLWX) / Waxara Cadde (GDDY 06)
   - Wardheere (DYOW 02) / Wardheer (GDDY 02)
   - Rati Weyne (DYCC 05) / Ratiweyne (section DSRW)
   - Lower-case words in "Xasan jiis", "Axmed gureey", "Aw awayska", "Wakaalada filimada"
2. **Dayniile sections named after 2022 districts.** "Garas Baalleey" (DYGB) and "Daarusalaam" (DYDS) are named after districts created from Dayniile in 2022. The Heliwaa section "Ceel Cirfiid" and the Daarusalaam › Lebiga sector "Ceel Cirfiid" also share a name. **Client action:** confirm these still belong where they are.
3. **Section points inside a different OSM district.** These 12 points, from the spec's Google Maps matching, fall inside another district's OSM boundary. They are kept unchanged, since a point can't be improved without verifying a better one, but don't rely on them:

   | Section | Confidence | Inside OSM district |
   |---|---|---|
   | HWSY Sayidka | medium | Wartanabadda |
   | HWXT Xaawa Taako | medium | Xamarweyne |
   | WRJD Janaraal Daa'uud | low | Boondheere |
   | HDKC Kacaan | low | Wadajir |
   | HDOK Oktoobar | low | Waaberi |
   | DKDY Dhamme Yaasiin Cartan | medium | Wadajir |
   | DKSR Saciid Rooraaye | low | Wadajir |
   | WDMH Maxamuud Hilowle | medium | Waaberi |
   | XWKC Kacaan | medium | Wartanabadda |
   | XWHL Hilaac | low | Wartanabadda |
   | KXAB Abaadir | low | Dharkeenley |
   | DYGB Garas Baalleey | medium | Kaxda |

   HWSY and HWXT sit on the Sayidka and Xaawo Taako monuments, which name the area but lie just outside it. OSM's boundaries predate 2022, so for the new districts a section of Garasbaalleey inside Kaxda or Dayniile, or a section of Gubadleey inside Heliwaa, is expected. Those are not counted here. Details are in `source/osm_checks.json`.
4. **Four section points on one spot.** HWXT, XWKC, XWHR and XWHL are all within 39 m of each other, and the three Xamarweyne ones within 12 m. Three different sections can't share one spot, so the geocoder most likely fell back to the same city-centre result. Treat all four as unverified.
5. **Nine points outside every mapped OSM district polygon.** These are DYCC, DYBR, DYHL, DYDS, HLBR, HLCL, DSRW, DSCM and GDCC, in the northern edge of the city, which OSM leaves unassigned. They are not errors; they just couldn't be tested. All 509 points are inside 1.95–2.20 N, 45.15–45.50 E.

## Coordinates improved (3)

Each was verified against OpenStreetMap through Overpass and Nominatim on 2026-10-25. The evidence is in `source/osm_checks.json`.

| Point | Old | New | Reason |
|---|---|---|---|
| Section KRNG Nageyle (Kaaraan) | 2.05478, 45.36575 · low (Google Maps: "Nageyle" supermarket) | **2.05394, 45.36658 · high** | OSM node 4924241025 is a `place=neighbourhood` named "Xaafada Nageyle", inside the OSM Kaaraan boundary. |
| Section DSRW Ratiweyne (Daarusalaam) | 2.13391, 45.32030 · placeholder | **2.15145, 45.33001 · medium** | OSM node 1404224271 is the `place=village` "Rati-Wayne" (alt "Rat Wayne", OCHA pcode NA-3807-W08-002), 2.2 km from the district point. It is medium, not high, because a village point isn't the centre of an urban section and the district has no boundary to test against. |
| Sector DSCM 03 Daban Doob (Daarusalaam › Ceel Mareer) | inherited 2.11896, 45.37037 | **2.13682, 45.35734 · medium** | OSM node 1404229793 is the `place=village` "Dabandoob", 2.5 km from its section point. It is the only sector with its own point. |

## Coordinates checked and left unchanged

**Corroborated by OSM, kept as they are:**
- KXSD Siinka Dheer: OSM village "Siinka Dheer" is 76 m away.
- BDDJ Daljirka: OSM monument "Daljirka Dahsoon".
- YQTW Towfiiq: OSM "isgoyska towfiiq" and "Hotel Towfiq" are nearby.

**Unverified.** Every other placeholder and low point stays as it was: 52 placeholder sections, 21 low sections, and 394 sectors inheriting their section's point. OSM (all named features and places in the Banaadir box) and a Nominatim search for each distinctive name found no reliable match. Most sector names are ordinals or common words.

**Candidates considered and rejected, so no point was guessed:**
- DYOW Oodweyne: "kaamil hospital oodweyne" is outside every mapped district, and a business doesn't mark an area's centre.
- DYCC 04 Jaran: OSM village "Jaran", 16 km west.
- KXSM 04 Dawacaale: OSM village "Dawacaale", 16 km north of Kaxda.
- DKDG Dhagaxtuur: the monument and school are in Xamarjajab and Howlwadaag.
- WDXT Xaawo Taako: the monument is in Xamarweyne.
- The Horseed, Barwaaqo, Jabuuti, Midnimo and Jamhuuriya sections: the OSM matches are a university, a fuel station, a street, a supermarket and a university in other districts.
- SBXL and WDXL Xalane, and DYCC 02 Ifka Xalane: "isgoyska ifka xalane" is a bus station outside every mapped district.
- OSM node 1401887561 "Ratiweyne" is a water well, so the village node was used instead.
- DYDS Daarusalaam: "Daru-Salaam City" is the point of the Daarusalaam district itself.

## Still needs a decision from the client

1. Region spelling: confirm "Banaadir" (§6.1).
2. DYRW, GBCE and GBGB: reactivate or reassign (§6.2, §6.3).
3. The 222 neighborhoods on inactive sectors, especially Ceel Turcaaye and Ceelmareer against Cali Turcaaye (§6.4).
4. A location code for Lebiga, and re-coding DSTKDB01–20 (§6.5).
5. The "Siinka Dheer" sector record (§6.6).
6. "Janaraal Daa" → "Janaraal Daa'uud"? (§6.7)
7. Renumber Weydoow's second sector 03 (§6.8).
8. The neighborhood code typos, `KRWJCC17B` and `HLCLSD` (§6.9).
9. The official spelling of each variant pair (§6.11 and "Other things flagged" 1).
10. Whether DYGB, DYDS and the two "Ceel Cirfiid" belong where they are ("Other things flagged" 2).
11. Field GPS for the 52 placeholder and 21 low sections, and the 13 points flagged in "Other things flagged" 3–4.

## Loaded into the app (2026-10-25)

At the user's request, `to_app_migration.py` generated `supabase/migrations/20261020000103_banaadir_locations.sql`, which was applied to the hosted database. It loads 94 sections, 395 sectors and 5,342 neighbourhoods into the Locations page, following the pattern already used for Kaaraan:
- Districts are matched by name to the app's own codes (for example, Kaaraan is 34 in the app).
- Sections: code `03`, name "Nageyle KR".
- Sectors: code `01`, name "Xaaji Laameer KRWJ".
- Blocks: code and name are the full block code, `KRWJXL01`.

Changes needed to fit the app:
- Kaaraan's 8 hand-made blocks were recoded from `01–08` to `KRWJXL01–08`, because block codes are unique per district. Existing parcel numbers are unchanged.
- Weydoow's Macaanteey got sector code **04** (the user's choice), since two sectors coded 03 are not allowed.

Not loaded:
- The 22 Cali Turcaaye (DSKLCT) blocks, because the export doesn't say which numbers they use.
- Coordinates: the app stores polygons, not points.

## Capacity, sector numbers and map pins (2026-10-25)

- **Capacity:** migration 0104 gives every neighbourhood a capacity of 50 (all 5,342).
- **Sector numbers:** sector codes (01, 02…) stay in the database, because the app needs a code to save a sector, but they are no longer shown. This covers the Locations table, the sector column next to blocks, the parcel zone picker, the reports area filter, and the sector dropdown when adding a block.
- **Map pins:** migration 0105 (generated by `to_app_pins.py`) adds `point`, `point_confidence` and `point_source` to sections and sectors.
  - It stores the 94 section points from `banaadir_locations.csv`, and Daban Doob's own verified point.
  - The map draws these as pins. Section pins are yellow and sector pins green. A placeholder pin (district centre, position unknown) is drawn hollow and has no label.
  - Clicking a pin shows its accuracy and source.
  - No boundaries were drawn. No public source has them, and made-up shapes would put parcels in the wrong block.
- **All sectors mapped:** migration 0106 makes `location_pins()` place every sector on the map, so all 395 sectors are now pinned.
  - A sector without its own point uses its section's point and is flagged `inherited`. This is the same as the "inherited from section" data the user supplied.
  - The point is not copied into `sectors.point`, so correcting a section's point moves its sectors with it.
  - On the map, these sectors show as a green ring around the section pin. Clicking the pin lists the section's sectors.
  - Nageyle and Ratiweyne keep their verified OSM points rather than the older Google Maps values in the supplied JSON. Their 8 sectors inherit the verified points.
