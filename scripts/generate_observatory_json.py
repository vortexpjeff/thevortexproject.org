#!/usr/bin/env python3
"""Generate observatory.json for thevortexproject.org — fetches space weather,
earth weather, bird detections, NEOs, ISS passes, and solar imagery metadata.

Designed to run as a cron no_agent script. Pushes directly to GitHub Pages repo.
"""

import json, os, sys, subprocess, datetime, time, urllib.request, urllib.error, re

# ── Config ──────────────────────────────────────────────────────────────
REPO_DIR = "/home/jvortex/vortex-site"
DATA_FILE = f"{REPO_DIR}/data/observatory.json"
LAT, LON = 35.86, -83.37  # Pine Hollow
NWS_ZONE = "TNZ073"
NASA_KEY = "f1Th3HNbz1PXDmqEKS8jpj5Hi8q936VS2eQXa5Q7"
UA = "SkyspaceChart/1.0"
TIMEOUT = 8

os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)

def fetch(url, timeout=TIMEOUT, headers=None):
    """Fetch URL, return parsed JSON or None on failure."""
    try:
        req = urllib.request.Request(url)
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None

def fetch_text(url, timeout=TIMEOUT):
    """Fetch URL, return raw text or None."""
    try:
        req = urllib.request.Request(url)
        req.add_header("User-Agent", UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode()
    except Exception:
        return None

def safe_float(v, default=None):
    try: return float(v)
    except: return default

# ── 1. Open-Meteo (Surface + Boundary + Upper + AQI) ────────────────────
print("→ Open-Meteo...")
om = fetch(f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}"
           f"&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,"
           f"pressure_msl,weather_code,cloud_cover,apparent_temperature,precipitation"
           f"&hourly=temperature_2m,precipitation_probability,cloud_cover,wind_speed_10m,wind_gusts_10m"
           f"&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max"
           f"&timezone=auto&forecast_days=3",
           headers={"User-Agent": UA})

aqi = fetch(f"https://air-quality-api.open-meteo.com/v1/air-quality?latitude={LAT}&longitude={LON}"
            f"&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto",
            headers={"User-Agent": UA})

surface = {}
if om:
    c = om.get("current", {})
    surface = {
        "temp_c": c.get("temperature_2m"),
        "humidity_pct": c.get("relative_humidity_2m"),
        "wind_kmh": c.get("wind_speed_10m"),
        "wind_dir": c.get("wind_direction_10m"),
        "pressure_hpa": c.get("pressure_msl"),
        "cloud_pct": c.get("cloud_cover"),
        "feels_c": c.get("apparent_temperature"),
        "precip_mm": c.get("precipitation"),
        "weather_code": c.get("weather_code"),
    }
    d = om.get("daily", {})
    if d:
        surface["today_max"] = d.get("temperature_2m_max", [None])[0]
        surface["today_min"] = d.get("temperature_2m_min", [None])[0]
        surface["sunrise"] = d.get("sunrise", [None])[0]
        surface["sunset"] = d.get("sunset", [None])[0]
        surface["precip_sum_mm"] = d.get("precipitation_sum", [None])[0]
    h = om.get("hourly", {})
    if h:
        # Next 6h wind + gust
        times = h.get("time", [])
        winds = h.get("wind_speed_10m", [])
        gusts = h.get("wind_gusts_10m", [])
        now_hour = datetime.datetime.now().hour
        next_6 = []
        for i, t in enumerate(times[:24]):
            if len(next_6) >= 6:
                break
            try:
                hh = int(t.split("T")[1].split(":")[0]) if "T" in t else 0
            except:
                continue
            if hh >= now_hour and i < len(winds):
                next_6.append({
                    "h": t[-5:] if "T" in t else str(hh),
                    "w": winds[i],
                    "g": gusts[i] if i < len(gusts) else None
                })
        surface["wind_hourly"] = next_6 if len(next_6) >= 3 else None

aqi_data = {}
if aqi:
    ac = aqi.get("current", {})
    aqi_data = {
        "us_aqi": ac.get("us_aqi"),
        "pm25": ac.get("pm2_5"),
        "pm10": ac.get("pm10"),
        "ozone": ac.get("ozone"),
        "no2": ac.get("nitrogen_dioxide"),
    }

# ── 2. SWPC — Solar Wind ────────────────────────────────────────────────
print("→ SWPC solar wind...")
rtsw_mag = fetch("https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json")
rtsw_wind = fetch("https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json")
summary_mag = fetch("https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json")
summary_speed = fetch("https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json")


def record_time(record):
    """Return a timezone-aware timestamp for a SWPC record, or None."""
    value = (record or {}).get("time_tag")
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


def utc_timestamp(value):
    """Normalize a source timestamp to an explicit UTC ISO-8601 string."""
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.timezone.utc)
        return parsed.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError):
        return value


def newest_active(records):
    """Choose the newest record, preferring an active source at that time."""
    if not records or not isinstance(records, list):
        return None
    usable = [r for r in records if isinstance(r, dict) and record_time(r)]
    if not usable:
        return None
    return max(usable, key=lambda r: (record_time(r), bool(r.get("active"))))


def fresh(record, max_age_hours=2):
    stamp = record_time(record)
    if not stamp:
        return False
    age = (datetime.datetime.now(datetime.timezone.utc) - stamp).total_seconds()
    return 0 <= age <= max_age_hours * 3600

mag_latest = newest_active(rtsw_mag)
wind_latest = newest_active(rtsw_wind)
summary_mag_latest = newest_active(summary_mag)
summary_speed_latest = newest_active(summary_speed)

solar_wind = {}
mag_record = mag_latest if fresh(mag_latest) else summary_mag_latest
if mag_record:
    solar_wind["bt_nt"] = safe_float(mag_record.get("bt"))
    solar_wind["bz_gse_nt"] = safe_float(mag_record.get("bz_gse"))
    solar_wind["bz_gsm_nt"] = safe_float(mag_record.get("bz_gsm"))
    solar_wind["bz_nt"] = solar_wind["bz_gsm_nt"]
    if solar_wind["bz_nt"] is None:
        solar_wind["bz_nt"] = solar_wind["bz_gse_nt"]
    solar_wind["time"] = utc_timestamp(mag_record.get("time_tag"))
    solar_wind["source"] = mag_record.get("source", "RTSW") if fresh(mag_latest) else "SWPC summary"

wind_record = wind_latest if fresh(wind_latest) else summary_speed_latest
if wind_record:
    solar_wind["speed_kms"] = safe_float(wind_record.get("proton_speed"))
    if fresh(wind_latest):
        solar_wind["density"] = safe_float(wind_record.get("proton_density"))
        solar_wind["temp_k"] = safe_float(wind_record.get("proton_temperature"))
    else:
        solar_wind["speed_time"] = utc_timestamp(wind_record.get("time_tag"))
        solar_wind["speed_source"] = "SWPC summary"

# Direction
bz = solar_wind.get("bz_nt")
if bz is not None:
    if bz < -5:
        solar_wind["bz_flag"] = "strongly southward"
    elif bz < 0:
        solar_wind["bz_flag"] = "mild southward"
    else:
        solar_wind["bz_flag"] = "northward"

# ── 3. SWPC — Kp + Dst ────────────────────────────────────────────────
print("→ Kp + Dst...")
kp_3h = fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json")
dst = fetch("https://services.swpc.noaa.gov/json/geospace/geospace_dst_1_hour.json")
kp_1m = fetch("https://services.swpc.noaa.gov/json/planetary_k_index_1m.json")

magnetosphere = {}
if kp_3h and len(kp_3h) > 0:
    latest = kp_3h[-1]
    vals_24h = [safe_float(x.get("Kp"), 0) for x in kp_3h[-8:]]
    magnetosphere["kp_now"] = safe_float(latest.get("Kp"))
    magnetosphere["kp_24h_min"] = round(min(vals_24h), 1) if vals_24h else None
    magnetosphere["kp_24h_max"] = round(max(vals_24h), 1) if vals_24h else None
    magnetosphere["kp_24h_mean"] = round(sum(vals_24h) / len(vals_24h), 1) if vals_24h else None
    magnetosphere["kp_time"] = latest.get("time_tag")

if kp_1m and len(kp_1m) > 0:
    magnetosphere["kp_1m"] = safe_float(kp_1m[-1].get("kp_index"))

if dst and len(dst) > 0:
    d = safe_float(dst[-1].get("dst"))
    magnetosphere["dst_nt"] = round(d, 1) if d is not None else None
    # Storm classification
    if d is not None:
        if d < -200: magnetosphere["dst_flag"] = "intense storm"
        elif d < -100: magnetosphere["dst_flag"] = "strong storm"
        elif d < -50: magnetosphere["dst_flag"] = "moderate storm"
        else: magnetosphere["dst_flag"] = "quiet"

# ── 4. SWPC — Kp Forecast ──────────────────────────────────────────────
print("→ Kp forecast...")
kp_fc = fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json")
kp_forecast = []
if kp_fc:
    predicted = [x for x in kp_fc if x.get("observed") == "predicted"]
    if predicted:
        # Group by date
        from collections import defaultdict
        by_date = defaultdict(list)
        for p in predicted:
            tag = p.get("time_tag", "")
            date_key = tag[:10] if len(tag) >= 10 else tag
            by_date[date_key].append(safe_float(p.get("kp"), 0))
        for dk in sorted(by_date.keys())[:3]:
            kp_forecast.append({
                "date": dk[-5:] if len(dk) >= 5 else dk,
                "bins": [round(v, 2) for v in by_date[dk]],
                "max": round(max(by_date[dk]), 2)
            })

# ── 5. GOES X-ray + Proton Flux ──────────────────────────────────────
print("→ GOES X-ray...")
xrays = fetch("https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json")
if not xrays:
    time.sleep(2)
    xrays = fetch("https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json")  # retry
protons = fetch("https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json")
flares = fetch("https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json")

sun = {}
if xrays and len(xrays) > 0:
    flux_vals = [safe_float(x.get("flux"), 0) for x in xrays]
    peak_flux = max(flux_vals) if flux_vals else 0
    current_flux = flux_vals[-1] if flux_vals else 0
    # Classify
    def flare_class(f):
        if f > 1e-4: return "X"
        if f > 1e-5: return "M"
        if f > 1e-6: return "C"
        if f > 1e-7: return "B"
        return "A"
    sun["xray_flux"] = round(current_flux, 10)
    sun["xray_peak"] = round(peak_flux, 10)
    sun["xray_class"] = flare_class(current_flux)
    sun["xray_peak_class"] = flare_class(peak_flux)

if flares and len(flares) > 0:
    f = flares[-1]
    sun["latest_flare"] = f"{f.get('begin_class','?')}→{f.get('max_class','?')}"
    sun["flare_time"] = f.get("time_tag")

if protons:
    gt10 = [x for x in protons if x.get("energy") == ">=10 MeV"]
    if gt10:
        pf = safe_float(gt10[-1].get("flux"), 0)
        sun["proton_flux_pfu"] = round(pf, 1)
        sun["sep_warning"] = pf > 10

# F10.7
f107 = fetch("https://services.swpc.noaa.gov/json/f107_cm_flux.json")
if f107 and len(f107) > 0:
    sun["f107"] = safe_float(f107[-1].get("flux"))

# Sunspot regions
regions = fetch("https://services.swpc.noaa.gov/json/solar_regions.json")
if regions:
    active = [r for r in regions if r.get("spots", 0) > 0]
    sun["active_regions"] = len(active)
    sun["regions"] = []
    for r in active[:8]:
        sun["regions"].append({
            "num": r.get("region"),
            "spots": r.get("spots"),
            "class": r.get("spot_class", ""),
            "area": r.get("area"),
        })

# ── 5b. Space-weather scales, aurora, forecast, and trends ─────────────
print("→ Space-weather outlook...")
scales_raw = fetch("https://services.swpc.noaa.gov/products/noaa-scales.json") or {}

def scale_summary(row):
    if not row:
        return None
    def scale_value(section, key="Scale"):
        value = (row.get(section) or {}).get(key)
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    return {
        "r": scale_value("R"),
        "s": scale_value("S"),
        "g": scale_value("G"),
        "r_text": (row.get("R") or {}).get("Text"),
        "s_text": (row.get("S") or {}).get("Text"),
        "g_text": (row.get("G") or {}).get("Text"),
        "minor_prob": safe_float((row.get("R") or {}).get("MinorProb")),
        "major_prob": safe_float((row.get("R") or {}).get("MajorProb")),
    }

space_scales = {
    "issued": scales_raw.get("0", {}).get("DateStamp") + "T" + scales_raw.get("0", {}).get("TimeStamp", "") if scales_raw.get("0") else None,
    "current": scale_summary(scales_raw.get("0")),
    "next_day": scale_summary(scales_raw.get("1")),
    "day_two": scale_summary(scales_raw.get("2")),
    "day_three": scale_summary(scales_raw.get("3")),
}

# Ovation is a global grid; publish only northern-hemisphere summary values.
aurora_raw = fetch("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json") or {}
aurora_values = []
for point in aurora_raw.get("coordinates", []):
    if not isinstance(point, list) or len(point) < 3:
        continue
    latitude = safe_float(point[1])
    probability = safe_float(point[2])
    if latitude is not None and latitude >= 0 and probability is not None:
        aurora_values.append(probability)
aurora = {
    "observation": aurora_raw.get("Observation Time"),
    "forecast": aurora_raw.get("Forecast Time"),
    "nh_max_probability": round(max(aurora_values), 1) if aurora_values else None,
}

forecast_raw = fetch("https://services.swpc.noaa.gov/json/45-day-forecast.json") or {}
forecast_rows = forecast_raw.get("data", []) if isinstance(forecast_raw, dict) else []

def forecast_series(metric, limit=14):
    return [
        {"time": row.get("time"), "value": row.get("value")}
        for row in forecast_rows if row.get("metric") == metric
    ][:limit]

space_forecast = {
    "issued": forecast_raw.get("issued"),
    "ap": forecast_series("ap"),
    "f107": forecast_series("f107"),
}

kp_history = [
    {"time": row.get("time_tag"), "value": safe_float(row.get("Kp"))}
    for row in (kp_3h or []) if isinstance(row, dict) and row.get("Kp") is not None
][-8:]
dst_history = [
    {"time": row.get("time_tag"), "value": safe_float(row.get("dst"))}
    for row in (dst or []) if isinstance(row, dict) and row.get("dst") is not None
][-24:]
xray_history = [
    {"time": row.get("time_tag"), "value": safe_float(row.get("flux"))}
    for row in (xrays or [])
    if isinstance(row, dict) and row.get("energy") == "0.1-0.8nm" and row.get("flux") is not None
][-24:]
space_trends = {"kp": kp_history, "dst": dst_history, "xray": xray_history}

# ── 6. GLOTEC TEC ─────────────────────────────────────────────────────
print("→ GLOTEC TEC...")
glotec_idx = fetch("https://services.swpc.noaa.gov/products/glotec/geojson_2d_urt.json")
ionosphere = {}
if glotec_idx and len(glotec_idx) > 0:
    latest = glotec_idx[-1]
    map_data = fetch("https://services.swpc.noaa.gov" + latest["url"], timeout=15)
    if map_data:
        features = map_data.get("features", [])
        best, best_dist = None, 999
        for f in features:
            lon, lat = f["geometry"]["coordinates"]
            dist = abs(lat - LAT) + abs(lon - (-abs(LON)))
            if dist < best_dist:
                best_dist = dist
                best = f
        if best:
            p = best["properties"]
            ionosphere = {
                "tec": safe_float(p.get("tec")),
                "hmf2_km": safe_float(p.get("hmF2")),
                "anomaly": safe_float(p.get("anomaly")),
            }

# ── 7. NASA NEO ───────────────────────────────────────────────────────
print("→ NEO...")
today = datetime.date.today().isoformat()
neo = fetch(f"https://api.nasa.gov/neo/rest/v1/feed?start_date={today}&end_date={today}&api_key={NASA_KEY}", timeout=12)
neo_data = {"count": 0, "objects": [], "hazardous_count": 0}
if neo:
    all_objs = []
    for date_key, items in neo.get("near_earth_objects", {}).items():
        for o in items:
            miss = safe_float(o["close_approach_data"][0]["miss_distance"]["lunar"])
            haz = o.get("is_potentially_hazardous_asteroid", False)
            dia = safe_float(o.get("estimated_diameter", {}).get("meters", {}).get("estimated_diameter_max"))
            all_objs.append({
                "name": o["name"],
                "miss_ld": round(miss, 1) if miss else None,
                "diameter_m": round(dia, 1) if dia else None,
                "hazardous": haz,
            })
    all_objs.sort(key=lambda x: x["miss_ld"] or 999)
    neo_data["count"] = len(all_objs)
    neo_data["objects"] = all_objs[:8]
    neo_data["hazardous_count"] = sum(1 for o in all_objs if o["hazardous"])
    neo_data["closest_ld"] = all_objs[0]["miss_ld"] if all_objs else None

# ── 8. ISS Pass via ephem (CelesTrak text) ────────────────────────────
print("→ ISS pass...")
try:
    import ephem
    iss_pass = None
    # Fetch TLE from CelesTrak text format (stable)
    tle_text = fetch_text("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE", timeout=12)
    if tle_text:
        lines = tle_text.strip().split("\n")
        if len(lines) >= 3:
            name = lines[0].strip()
            line1 = lines[1].strip()
            line2 = lines[2].strip()
            iss = ephem.readtle(name, line1, line2)
            obs = ephem.Observer()
            obs.lat = str(LAT)
            obs.lon = str(LON)
            obs.elevation = 324
            obs.date = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            try:
                tr, azr, tt, mx_alt, azs, ts = obs.next_pass(iss)
                if tr and tt and mx_alt is not None:
                    def d2dt(d):
                        t = ephem.Date(d).tuple()
                        return datetime.datetime(int(t[0]), int(t[1]), int(t[2]),
                                                 int(t[3]), int(t[4]), int(t[5]),
                                                 tzinfo=datetime.timezone.utc)
                    rise_dt = d2dt(tr)
                    iss_pass = {
                        "rise": rise_dt.isoformat(),
                        "max_elevation": round(float(mx_alt) * 180 / 3.14159, 0),
                        "duration_min": round((tt - tr) * 24 * 60, 1),
                    }
            except Exception:
                iss_pass = None
except ImportError:
    iss_pass = None

# ── 9. NWS Alerts ──────────────────────────────────────────────────────
print("→ NWS alerts...")
nws = fetch(f"https://api.weather.gov/alerts/active/zone/{NWS_ZONE}", headers={"User-Agent": UA}, timeout=8)
alerts = []
if nws:
    for f in nws.get("features", [])[:5]:
        p = f["properties"]
        alerts.append({
            "event": p.get("event"),
            "severity": p.get("severity"),
            "headline": (p.get("headline") or "")[:120],
            "expires": p.get("expires"),
        })

# ── 12. BirdNET via SSH ────────────────────────────────────────────────
print("→ BirdNET...")
birds = None
try:
    # Use existing SSH access to BirdNET-Pi
    askpass = "/tmp/askpass.sh"
    with open(askpass, "w") as f:
        f.write("#!/bin/sh\necho 'birdnetpi'\n")
    os.chmod(askpass, 0o755)
    env = os.environ.copy()
    env["DISPLAY"] = ":0"
    env["SSH_ASKPASS"] = askpass
    env["SSH_ASKPASS_REQUIRE"] = "force"
    
    result = subprocess.run(
        ["ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=8",
         "birdnetpi@192.168.1.223",
         "tail -20000 /home/birdnetpi/BirdNET-Pi/BirdDB.txt"],
        env=env, capture_output=True, text=True, timeout=15
    )
    if result.returncode == 0:
        lines = result.stdout.strip().split("\n")
        species_count = {}
        recent = []
        cutoff = datetime.datetime.now() - datetime.timedelta(hours=24)
        for line in lines:
            parts = line.split(";")
            if len(parts) >= 5:
                try:
                    detected_at = datetime.datetime.strptime(
                        f"{parts[0].strip()} {parts[1].strip()}", "%Y-%m-%d %H:%M:%S"
                    )
                except ValueError:
                    continue
                if detected_at < cutoff:
                    continue
                sp = parts[3].strip()
                conf = safe_float(parts[4].strip())
                if sp and conf is not None:
                    species_count[sp] = species_count.get(sp, 0) + 1
                    recent.append({"species": sp, "confidence": round(conf * 100, 1),
                                   "time": f"{parts[0]} {parts[1]}"})
        top = sorted(species_count.items(), key=lambda x: x[1], reverse=True)[:8]
        birds = {
            "detections_24h": sum(species_count.values()),
            "species_count": len(species_count),
            "top_species": [{"name": n, "count": c} for n, c in top],
            "recent": recent[-5:],
        }
except Exception:
    birds = None

# ── 13. Assemble ───────────────────────────────────────────────────────
output = {
    "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "location": {"name": "Observatory Station"},
    "surface": surface,
    "air_quality": aqi_data,
    "ionosphere": ionosphere,
    "magnetosphere": magnetosphere,
    "solar_wind": solar_wind,
    "sun": sun,
    "space_weather": {
        "scales": space_scales,
        "aurora": aurora,
        "forecast": space_forecast,
        "trends": space_trends,
    },
    "kp_forecast": kp_forecast,
    "neo": neo_data,
    "iss_pass": iss_pass,
    "alerts": alerts,
    "birds": birds,
}

with open(DATA_FILE, "w") as f:
    json.dump(output, f, indent=2)

size = os.path.getsize(DATA_FILE)
print(f"✓ Written {DATA_FILE} ({size} bytes)")

# ── 14. Git push ───────────────────────────────────────────────────────
if os.environ.get("OBSERVATORY_NO_PUSH") == "1":
    print("✓ Validation run complete; git commit/push skipped")
    sys.exit(0)

print("→ git push...")
add_result = subprocess.run(
    ["git", "-C", REPO_DIR, "add", "data/observatory.json"],
    capture_output=True, text=True
)
if add_result.returncode != 0:
    print(f"⚠ git add failed (rc={add_result.returncode}): {add_result.stderr.strip()[:200]}")
    sys.exit(add_result.returncode)

commit_result = subprocess.run(
    ["git", "-C", REPO_DIR, "-c", "user.name=Vortex Observatory",
     "-c", "user.email=observatory@thevortexproject.org",
     "commit", "-m", f"observatory data {datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')}"],
    capture_output=True, text=True
)
commit_output = f"{commit_result.stdout}\n{commit_result.stderr}".lower()
if commit_result.returncode != 0 and "nothing to commit" not in commit_output:
    print(f"⚠ git commit failed (rc={commit_result.returncode}): {commit_output.strip()[:200]}")
    sys.exit(commit_result.returncode)

push_result = subprocess.run(
    ["git", "-C", REPO_DIR, "-c",
     "credential.helper=store",
     "push", "origin", "main"],
    capture_output=True, text=True
)
if push_result.returncode != 0:
    print(f"⚠ Push failed (rc={push_result.returncode}): {push_result.stderr.strip()[:200]}")
    sys.exit(push_result.returncode)
else:
    print("✓ Push complete")
print(json.dumps(output, indent=2)[:200] + "...")
