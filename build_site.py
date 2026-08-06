#!/usr/bin/env python3
"""Build and validate the public Yuseong heatwave web-map package.

This script assembles the split GitHub Pages version and the standalone HTML
from the public GeoJSON/JSON files in ``data/`` and the separated assets in
``css/`` and ``js/``.  When the original road-temperature Folium HTML is
provided, it also re-extracts all 9,557 road links and their public detail
fields.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Any

DATA_KEYS = {
    "residential": "residential_grid.geojson",
    "activity": "activity_grid.geojson",
    "diagnosis": "diagnosis_grid.geojson",
    "boundary": "dong_boundary.geojson",
    "policy": "policy_candidates.geojson",
    "roadHeat": "road_heat.geojson",
    "lst": "lst30m.geojson",
    "summary": "summary.json",
}
LOCAL_SCRIPTS = ["config.js", "charts.js", "map.js", "app.js"]
REMOVED_POPULATION_FIELDS = {"HRP", "HRP_ratio", "HRPscore_100", "hrp_detail_source"}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def extract_road_heat(road_html: Path, output_path: Path) -> int:
    """Extract road features and the requested link-level detail fields."""
    text = road_html.read_text(encoding="utf-8")
    decoder = json.JSONDecoder()
    position = 0
    raw_features: list[dict[str, Any]] = []
    while True:
        match = re.search(r"_add\(\s*", text[position:])
        if not match:
            break
        start = position + match.end()
        try:
            obj, end = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            position = start + 1
            continue
        features = obj.get("features", []) if isinstance(obj, dict) else []
        if features and "LINK_ID" in features[0].get("properties", {}):
            raw_features.extend(features)
        position = start + end

    if not raw_features:
        raise RuntimeError("도로온도 HTML에서 LINK_ID 도로 피처를 찾지 못했습니다.")

    public_features = []
    seen: set[str] = set()
    for feature in raw_features:
        p = feature["properties"]
        link_id = str(p["LINK_ID"])
        if link_id in seen:
            continue
        seen.add(link_id)
        grade = p.get("road_heat_grade_5")
        props = {
            "link_id": link_id,
            "road_name": p.get("ROAD_NAME"),
            "lanes": p.get("LANES"),
            "max_speed": p.get("MAX_SPD"),
            "length_m": round(float(p["LENGTH"]), 3) if p.get("LENGTH") is not None else None,
            "mean_lst": p.get("mean_lst_c"),
            "top10_lst": p.get("p90_lst_c"),
            "max_lst": p.get("max_lst_c"),
            "mean_anomaly": p.get("mean_anomaly_c"),
            "mean_percentile": p.get("mean_percentile"),
            "above33_ratio": p.get("above_33_ratio"),
            "valid_date_count": p.get("valid_date_count"),
            "mean_road_fraction": p.get("mean_road_fraction"),
            "heat_score": p.get("road_heat_score_100"),
            "grade": int(round(float(grade))) if grade is not None else None,
            "data_quality": p.get("data_quality"),
        }
        public_features.append({"type": "Feature", "properties": props, "geometry": feature["geometry"]})

    dump_json(output_path, {"type": "FeatureCollection", "features": public_features})
    return len(public_features)


def sanitize_grid_data(data_dir: Path) -> None:
    """Remove the retired population indicator fields from every public grid."""
    for filename in ("residential_grid.geojson", "activity_grid.geojson"):
        path = data_dir / filename
        data = load_json(path)
        for feature in data.get("features", []):
            props = feature.get("properties", {})
            for key in REMOVED_POPULATION_FIELDS:
                props.pop(key, None)
            props["population_detail_source"] = "연령별 인구구조 원본 GPKG"
        dump_json(path, data)

    summary_path = data_dir / "summary.json"
    summary = load_json(summary_path)
    sources = summary.get("enrichment_sources", {})
    if "hrp_detail" in sources:
        item = sources.pop("hrp_detail")
        item["fields"] = [x for x in item.get("fields", []) if x not in REMOVED_POPULATION_FIELDS]
        sources["population_structure_detail"] = item
    dump_json(summary_path, summary)


def embedded_data(data_dir: Path) -> dict[str, Any]:
    return {key: load_json(data_dir / filename) for key, filename in DATA_KEYS.items()}


def build_standalone(package_dir: Path) -> Path:
    index_path = package_dir / "yuseong-heatwave-map-index.html"
    html = index_path.read_text(encoding="utf-8")
    css = (package_dir / "css" / "style.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="css/style.css">', f"<style>{css}</style>")

    data_script = "<script>window.EMBEDDED_DATA=" + json.dumps(
        embedded_data(package_dir / "data"), ensure_ascii=False, separators=(",", ":")
    ) + ";</script>"
    leaflet_script = '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>'
    html = html.replace(leaflet_script, data_script + leaflet_script, 1)

    for name in LOCAL_SCRIPTS:
        source = (package_dir / "js" / name).read_text(encoding="utf-8")
        html = html.replace(f'<script src="js/{name}"></script>', f"<script>{source}</script>")

    output = package_dir / "yuseong-heatwave-map-share.html"
    output.write_text(html, encoding="utf-8")
    return output


def validate(package_dir: Path) -> dict[str, int]:
    required = [
        package_dir / "yuseong-heatwave-map-index.html",
        package_dir / "yuseong-heatwave-map-share.html",
        package_dir / "css" / "style.css",
        *[package_dir / "js" / name for name in LOCAL_SCRIPTS],
        *[package_dir / "data" / name for name in DATA_KEYS.values()],
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("필수 파일 누락: " + ", ".join(missing))

    road_count = len(load_json(package_dir / "data" / "road_heat.geojson").get("features", []))
    policy_count = len(load_json(package_dir / "data" / "policy_candidates.geojson").get("features", []))
    index = (package_dir / "yuseong-heatwave-map-index.html").read_text(encoding="utf-8")
    map_js = (package_dir / "js" / "map.js").read_text(encoding="utf-8")
    app_js = (package_dir / "js" / "app.js").read_text(encoding="utf-8")
    config_js = (package_dir / "js" / "config.js").read_text(encoding="utf-8")
    css = (package_dir / "css" / "style.css").read_text(encoding="utf-8")
    checks = [
        "layer-dropdown" in index,
        "selectedGridId" in map_js,
        "roadLinkDetailHTML" in map_js,
        "policyDisplayName" in map_js,
        "renderMainDongMask" in map_js,
        "features: outlineFC.features.filter((f) => f.properties.dong && f.properties.dong !== selectedDong)" in map_js,
        ("온열질환" + " 고위험 인구") not in index + map_js,
        'class="view mapview on" id="v-map"' in index,
        'data-view="map">통합지도</button>' in index,
        "p.diagnosis === '기타 교차지역'" in map_js,
        "compareTopBtn" in index + app_js,
        "compareProfiles" in index + app_js,
        "compareDiagnosisMix" in index + app_js,
        "compareAllRank" in index + app_js,
        "roadHeatPane" in map_js,
        "roadRenderer = L.svg" in map_js,
        "compareScatter" in index + app_js,
        "comparePolicyDirection" in index + app_js,
        "roadPriorityPane" in map_js,
        "lstColors" in map_js + config_js,
        '"center":[36.3578,127.345621],"zoom":15.25' in config_js,
        "soft-osm-tiles" in map_js + css,
    ]
    if not all(checks):
        raise RuntimeError("UI 기능 문자열 검증에 실패했습니다.")
    return {"road_links": road_count, "policy_candidates": policy_count}


def make_zip(package_dir: Path, zip_path: Path) -> None:
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(package_dir.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                archive.write(path, Path(package_dir.name) / path.relative_to(package_dir))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--road-html", type=Path)
    parser.add_argument("--zip-path", type=Path)
    args = parser.parse_args()

    source = args.package_dir.resolve()
    target = args.output_dir.resolve() if args.output_dir else source
    if target != source:
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))

    if args.road_html:
        count = extract_road_heat(args.road_html, target / "data" / "road_heat.geojson")
        summary_path = target / "data" / "summary.json"
        summary = load_json(summary_path)
        summary.setdefault("counts", {})["road_heat_links"] = count
        dump_json(summary_path, summary)

    sanitize_grid_data(target / "data")
    build_standalone(target)
    result = validate(target)
    zip_path = args.zip_path or target.with_suffix(".zip")
    make_zip(target, zip_path)
    print(json.dumps({"package": str(target), "zip": str(zip_path), **result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
