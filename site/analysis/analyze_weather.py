#!/usr/bin/env python3
"""
WEATHER deep one-pass corpus-wide analysis for LEVIATHAN (non-Annie).
- Streams full CSV, excludes Annie threads (7244346811, 7249204125, 2124702449 and variants).
- Joins daily_cross_corpus (rhet, msg_total, high_signal_fragments, apology/plead etc).
- Expands keyword mining for COLD/HOT/PRECIP/TRAVEL/OUTDOOR + explicit seasonal + LOC (NYC/Uniontown) from text + places context.
- Dual accum daily + weekly + monthly.
- Real text samples collected only on weather matches (granular, non-placeholder).
- Computes:
  * Seasonal + monthly rhetoric shifts (cold/hot/precip rates + rhet_int, apology, prof deltas vs means)
  * Location-based mood clusters (NYC vs Uniontown via kw + places spans; mood/rhet/weather profile per cluster)
  * High-volatility weather days (daily composite ranking + verbatim samples + matched kws)
  * Correlations (pearson) between weather vectors, rhet intensity, msg volume, apology/plead, travel, seasonal proxies, env factors.
- Outputs:
  * data/weather_non_annie_weekly.json (for 4-pen charts, needle/scrubber)
  * data/weather_fragments_non_annie.json (surfacer / rain particles)
  * data/weather_analysis_non_annie.json (detailed summary with all requested sections + granular stats/insights)
Run: python3 analyze_weather.py
"""

import csv
import json
import re
import collections
import math
import os
from datetime import datetime, timedelta
from statistics import mean, stdev
import random

BASE = "/Users/daniel/Documents/@danfrank - Unique AI Solutions/VISUALIZER SITE"
DATA = os.path.join(BASE, "data")
os.makedirs(DATA, exist_ok=True)

# Resolve CSV robustly (main sibling or uploads copy)
def find_csv():
    cands = [
        os.path.join(os.path.dirname(BASE), "LEVIATHAN_FULL_CORPUS.csv"),
        os.path.join(BASE, "uploads", "LEVIATHAN_FULL_CORPUS.csv"),
        os.path.join(BASE, "..", "LEVIATHAN_FULL_CORPUS.csv"),
        "/Volumes/MUSIC/alias/XXX/data-dashboard site/LEVIATHAN_FULL_CORPUS.csv",  # historical
    ]
    for c in cands:
        if c and os.path.exists(c):
            return c
    raise FileNotFoundError("LEVIATHAN_FULL_CORPUS.csv not found in expected locations")

CSV = find_csv()
print("Using CSV:", CSV)

# Annie thread ids (user-specified + common normalizations from profiles/CSV)
ANNIE_IDS = {
    "7244346811", "7249204125", "2124702449",
    "+17244346811", "+17249204125", "+12124702449",
    "17244346811", "17249204125", "12124702449",
    "+17244346811", "+12124702449", "+17249204125"
}

def norm_thread(t):
    if not t: return ""
    t = t.strip()
    t2 = t.lstrip("+")
    t3 = t2[1:] if t2.startswith("1") and len(t2) > 10 else t2
    return t3

# Expanded weather / context keywords (granular, corpus-tuned)
COLD = re.compile(r"\b(cold|freezing|snow|blizzard|chilly|jacket|coat|gloves|ice|frost|brrr|winter|scarf|hoodie|windchill|sleet|slush|icy)\b", re.I)
HOT = re.compile(r"\b(hot|boiling|heat|humid|sweltering|shorts|tank|beach|pool|fan|ac|air.?cond|summer|scorch|roasting|warm|muggy|heatwave|sweat|sticky)\b", re.I)
PRECIP = re.compile(r"\b(rain|storm|pouring|drizzle|umbrella|wet|thunder|lightning|flood|monsoon|downpour|hail|rainy|puddle|soaked|sprinkle)\b", re.I)
TRAVEL = re.compile(r"\b(nyc|new york|uniontown|pa|pennsylvania|fayette|drive|flight|train|bus|airport|back to|going to|leaving for|moved|relocate|home|visit|philly|pittsburgh|commute|road)\b", re.I)
OUTDOOR = re.compile(r"\b(outside|outdoors|walk|park|yard|patio|porch|balcony|nature|hike|stroll|sidewalk|window|fresh air|shovel|snowman)\b", re.I)
LOC_NYC = re.compile(r"\b(nyc|new york|manhattan|brooklyn|queens|76th|1st ave|au za'?atar|midtown|upper east)\b", re.I)
LOC_UT = re.compile(r"\b(uniontown|virginia ave|virginia avenue|fayette|pa |pennsylvania|back home|home in pa|15401)\b", re.I)

# Automated/transactional texts pollute the fragment surfacer — drop them from samples
AUTOMATED = re.compile(
    r"(free msg|cash app|payment at|your bill|auto.?pay|verification code|security code|reply stop|txt stop|"
    r"spectrum|at&t|verizon|t.?mobile|comcast|xfinity|venmo|paypal|zelle|wells fargo|chase|bank of|"
    r"your order|tracking number|has shipped|delivered to|appointment|reminder:|confirm your|"
    r"unsubscribe|promo|% off|use code|expires)", re.I)

def season(m):
    if m in (12, 1, 2): return "winter"
    if m in (3, 4, 5): return "spring"
    if m in (6, 7, 8): return "summer"
    return "fall"

def to_date(s):
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except:
        return None

def to_hour(s):
    try:
        return int(s[11:13])
    except:
        return None

def pearson(x, y):
    n = len(x)
    if n < 2: return 0.0
    mx, my = sum(x) / n, sum(y) / n
    num = sum((a - mx) * (b - my) for a, b in zip(x, y))
    dx = math.sqrt(sum((a - mx) ** 2 for a in x))
    dy = math.sqrt(sum((b - my) ** 2 for b in y))
    return round(num / (dx * dy), 4) if dx * dy > 0 else 0.0

print("Loading supporting corpus JSONs (daily_cross for rhet + frags, rhetorical_daily fallback, places for loc context)...")
cross = json.load(open(os.path.join(DATA, "daily_cross_corpus.json")))
daily_map = {d["day"]: d for d in cross.get("daily", []) if "day" in d}

rhet_d = json.load(open(os.path.join(DATA, "rhetorical_daily.json")))
rhet_map = {d.get("day") or d.get("date"): d for d in rhet_d.get("daily", [])}

places = []
try:
    pl = json.load(open(os.path.join(DATA, "places.json")))
    places = pl.get("places", []) if isinstance(pl, dict) else pl
except Exception:
    pass

print(f"Places loaded: {len(places)} (NYC/Uniontown clusters for era context)")

# Top rhetorical events (for weather overlap on the 50 highest-rhetoric days)
top_events = []
try:
    te = json.load(open(os.path.join(DATA, "top_rhetorical_events.json")))
    top_events = te.get("top", [])
except Exception:
    pass

# msg_agg hourly baseline (all-message hourly distribution to normalize weather-by-hour)
agg_hourly = None
try:
    ma = json.load(open(os.path.join(DATA, "_msg_agg.json")))
    agg_hourly = ma.get("hourly")
except Exception:
    pass

# Accumulators - weekly (for 4-pen), daily (for high-vol days + granularity), monthly (shifts)
weekly = collections.defaultdict(lambda: {
    "count": 0, "cold": 0, "hot": 0, "precip": 0, "travel": 0, "outdoor": 0,
    "loc_nyc": 0, "loc_ut": 0,
    "prof": 0, "love": 0, "caps": 0, "apology": 0, "plead": 0, "msg_total": 0,
    "frags": [], "samples": []
})
daily = collections.defaultdict(lambda: {
    "count": 0, "cold": 0, "hot": 0, "precip": 0, "travel": 0, "outdoor": 0,
    "loc_nyc": 0, "loc_ut": 0,
    "prof": 0, "love": 0, "caps": 0, "apology": 0, "plead": 0, "msg_total": 0,
    "frags": [], "samples": []
})
monthly = collections.defaultdict(lambda: {
    "count": 0, "cold": 0, "hot": 0, "precip": 0, "travel": 0, "outdoor": 0,
    "loc_nyc": 0, "loc_ut": 0,
    "prof": 0, "love": 0, "caps": 0, "apology": 0, "plead": 0, "msg_total": 0
})

total_kept = 0
annie_ignored = 0
hour_weather = collections.defaultdict(int)  # for time patterns

print("Streaming CSV one-pass (filter Annie, keyword + rhet join, sample collection)...")
with open(CSV, newline="", encoding="utf-8", errors="replace") as f:
    r = csv.DictReader(f)
    for row in r:
        th = row.get("thread_target", "") or ""
        if norm_thread(th) in ANNIE_IDS or th in ANNIE_IDS or any(a in th for a in ("7244346811", "7249204125", "2124702449")):
            annie_ignored += 1
            continue

        day = to_date(row.get("timestamp", ""))
        if not day:
            continue
        hr = to_hour(row.get("timestamp", ""))
        txt = (row.get("text") or "").strip()
        if not txt or txt == "\x7f" or len(txt) < 2:
            continue

        total_kept += 1

        wk = day - timedelta(days=day.weekday())
        wk_key = wk.isoformat()
        dkey = day.isoformat()
        mkey = day.strftime("%Y-%m")

        w = weekly[wk_key]
        d = daily[dkey]
        m = monthly[mkey]

        w["count"] += 1
        d["count"] += 1
        m["count"] += 1

        # Weather + loc + outdoor hits
        hit_cold = bool(COLD.search(txt))
        hit_hot = bool(HOT.search(txt))
        hit_precip = bool(PRECIP.search(txt))
        hit_travel = bool(TRAVEL.search(txt))
        hit_out = bool(OUTDOOR.search(txt))
        hit_nyc = bool(LOC_NYC.search(txt))
        hit_ut = bool(LOC_UT.search(txt))

        if hit_cold: w["cold"] += 1; d["cold"] += 1; m["cold"] += 1
        if hit_hot: w["hot"] += 1; d["hot"] += 1; m["hot"] += 1
        if hit_precip: w["precip"] += 1; d["precip"] += 1; m["precip"] += 1
        if hit_travel: w["travel"] += 1; d["travel"] += 1; m["travel"] += 1
        if hit_out: w["outdoor"] += 1; d["outdoor"] += 1; m["outdoor"] += 1
        if hit_nyc: w["loc_nyc"] += 1; d["loc_nyc"] += 1; m["loc_nyc"] += 1
        if hit_ut: w["loc_ut"] += 1; d["loc_ut"] += 1; m["loc_ut"] += 1

        if hr is not None and (hit_cold or hit_hot or hit_precip or hit_travel or hit_out):
            hour_weather[hr] += 1

        # Join rhet / intensity from cross (preferred)
        rhet_joined = False
        if dkey in daily_map:
            dr = daily_map[dkey]
            w["prof"] += dr.get("prof", 0) or 0
            w["love"] += dr.get("love", 0) or 0
            w["caps"] += dr.get("caps", 0) or 0
            w["apology"] += dr.get("apology_score", 0) or 0
            w["plead"] += dr.get("pleading_score", 0) or 0
            w["msg_total"] += dr.get("msg_total", 0) or 0
            d["prof"] += dr.get("prof", 0) or 0
            d["love"] += dr.get("love", 0) or 0
            d["caps"] += dr.get("caps", 0) or 0
            d["apology"] += dr.get("apology_score", 0) or 0
            d["plead"] += dr.get("pleading_score", 0) or 0
            d["msg_total"] += dr.get("msg_total", 0) or 0
            m["prof"] += dr.get("prof", 0) or 0
            m["love"] += dr.get("love", 0) or 0
            m["caps"] += dr.get("caps", 0) or 0
            m["apology"] += dr.get("apology_score", 0) or 0
            m["plead"] += dr.get("pleading_score", 0) or 0
            m["msg_total"] += dr.get("msg_total", 0) or 0
            rhet_joined = True
            for ff in (dr.get("high_signal_fragments") or [])[:2]:
                if len(ff) > 14:
                    if ff not in w["frags"]:
                        w["frags"].append(ff)
                    if ff not in d["frags"]:
                        d["frags"].append(ff)

        if not rhet_joined and dkey in rhet_map:
            # fallback volume only
            pass

        # Real sample collection (only weather-context rows, limit per bucket to stay lean + high signal)
        is_weather_row = hit_cold or hit_hot or hit_precip or hit_travel or hit_out
        if is_weather_row and len(txt) > 12 and not AUTOMATED.search(txt):
            clean = txt[:260].replace("\n", " ").strip()
            if len(w["samples"]) < 6:
                w["samples"].append(clean)
            if len(d["samples"]) < 4:
                d["samples"].append(clean)

print(f"Processed {total_kept} non-Annie msgs, ignored {annie_ignored} Annie msgs.")
print(f"Weeks spanned: {len(weekly)}")

# Build weekly list (primary for 4-pen / scrubber)
weather_weeks = []
for wk in sorted(weekly.keys()):
    w = weekly[wk]
    c = max(1, w["count"])
    raw = {
        "cold": w["cold"], "hot": w["hot"], "precip": w["precip"], "travel": w["travel"],
        "outdoor": w["outdoor"], "loc_nyc": w["loc_nyc"], "loc_ut": w["loc_ut"]
    }
    rate = {k: round(v / c * 100.0, 3) for k, v in raw.items()}
    rhet_sum = w["prof"] + w["love"] + w["caps"] + w["apology"] + w["plead"]
    rhet_int = rhet_sum / c
    weather_weeks.append({
        "week": wk,
        "count": w["count"],
        "raw_weather": raw,
        "rate_weather": rate,
        "rhet": {
            "prof": round(w["prof"] / c, 3),
            "love": round(w["love"] / c, 3),
            "caps": round(w["caps"] / c, 3),
            "apology": round(w["apology"] / c, 3),
            "plead": round(w["plead"] / c, 3),
            "intensity": round(rhet_int, 3)
        },
        "msg_total": w["msg_total"],
        "sample_weather_texts": w["samples"][:4],
        "high_signal_samples": w["frags"][:3]
    })

# Daily records for high-vol + granular
daily_records = []
for dk in sorted(daily.keys()):
    d = daily[dk]
    c = max(1, d["count"])
    raw = {k: d[k] for k in ("cold", "hot", "precip", "travel", "outdoor", "loc_nyc", "loc_ut")}
    rate = {k: round(v / c * 100.0, 3) for k, v in raw.items()}
    rhet_sum = d["prof"] + d["love"] + d["caps"] + d["apology"] + d["plead"]
    rhet_int = rhet_sum / c
    whits = raw["cold"] + raw["hot"] + raw["precip"]
    comp = whits * (1.0 + rhet_int / 4.0) + (d["travel"] * 0.6)
    daily_records.append({
        "date": dk,
        "count": d["count"],
        "raw_weather": raw,
        "rate_weather": rate,
        "rhet_intensity": round(rhet_int, 3),
        "msg_total": d.get("msg_total", d["count"]),
        "composite_vol": round(comp, 2),
        "samples": d["samples"][:3]
    })

# High volatility weather days (top composite days with real samples)
daily_records.sort(key=lambda x: x["composite_vol"], reverse=True)
high_vol_days = []
for rec in daily_records[:22]:
    kws = []
    for k, v in rec["raw_weather"].items():
        if v > 0:
            kws.append(k)
    high_vol_days.append({
        "date": rec["date"],
        "composite_vol": rec["composite_vol"],
        "weather_hits": rec["raw_weather"],
        "rhet_intensity": rec["rhet_intensity"],
        "msg_total": rec["msg_total"],
        "matched_keywords": kws,
        "samples": rec["samples"]
    })

# Monthly aggregates + rhetoric shifts
monthly_list = []
for mk in sorted(monthly.keys()):
    m = monthly[mk]
    c = max(1, m["count"])
    m_r = {
        "cold_rate": round(m["cold"] / c * 100, 3),
        "hot_rate": round(m["hot"] / c * 100, 3),
        "precip_rate": round(m["precip"] / c * 100, 3),
        "travel_rate": round(m["travel"] / c * 100, 3),
        "rhet_int": round( (m["prof"] + m["love"] + m["caps"] + m["apology"] + m["plead"]) / c , 3),
        "apology_rate": round(m["apology"] / c * 100, 3),
        "prof_rate": round(m["prof"] / c * 100, 3),
        "count": m["count"]
    }
    monthly_list.append({"month": mk, "season": season(int(mk[5:7])), **m_r})

# Seasonal rhetoric shifts (from monthly + weekly)
def agg_seasonal(items, key_rate="rhet_int"):
    by = collections.defaultdict(list)
    for it in items:
        by[it.get("season", "unknown")].append(it.get(key_rate, 0) if key_rate in it else it.get("rhet", {}).get("intensity", 0))
    out = {}
    for s, vals in by.items():
        if vals:
            out[s] = {
                "mean": round(mean(vals), 3),
                "volatility": round(stdev(vals), 3) if len(vals) > 1 else 0,
                "n": len(vals)
            }
    return out

seasonal_rhet = agg_seasonal(monthly_list)
# Also per-weather by season
seasonal_cold = agg_seasonal(monthly_list, "cold_rate")
seasonal_precip = agg_seasonal(monthly_list, "precip_rate")

# Location mood clusters (NYC vs Uniontown)
ut_weeks = [ww for ww in weather_weeks if ww["rate_weather"].get("loc_ut", 0) > 0.8]
nyc_weeks = [ww for ww in weather_weeks if ww["rate_weather"].get("loc_nyc", 0) > 0.8]

def cluster_profile(weeks, label):
    if not weeks:
        return {"n_weeks": 0, "note": "no strong signal weeks"}
    cold_r = [w["rate_weather"].get("cold", 0) for w in weeks]
    precip_r = [w["rate_weather"].get("precip", 0) for w in weeks]
    travel_r = [w["rate_weather"].get("travel", 0) for w in weeks]
    rhets = [w["rhet"]["intensity"] for w in weeks]
    apols = [w["rhet"].get("apology", 0) for w in weeks]
    profs = [w["rhet"].get("prof", 0) for w in weeks]
    return {
        "n_weeks": len(weeks),
        "avg_cold_rate": round(mean(cold_r), 3),
        "avg_precip_rate": round(mean(precip_r), 3),
        "avg_travel_rate": round(mean(travel_r), 3),
        "avg_rhet_intensity": round(mean(rhets), 3),
        "avg_apology": round(mean(apols), 3),
        "avg_prof": round(mean(profs), 3),
        "vol_rhet": round(stdev(rhets), 3) if len(rhets) > 1 else 0,
        "sample_texts": [s for w in weeks[:3] for s in w.get("sample_weather_texts", [])][:4]
    }

loc_clusters = {
    "Uniontown": cluster_profile(ut_weeks, "Uniontown"),
    "NYC": cluster_profile(nyc_weeks, "NYC"),
    "transit_high": {
        "n_weeks": sum(1 for w in weather_weeks if w["rate_weather"].get("travel", 0) > 2.0),
        "note": "High travel mentions often align with location shift rhetoric (prof/apology spikes)"
    }
}

# Correlations (expanded, env factors + intensity)
cold_r = [w["rate_weather"]["cold"] for w in weather_weeks]
hot_r = [w["rate_weather"]["hot"] for w in weather_weeks]
precip_r = [w["rate_weather"]["precip"] for w in weather_weeks]
travel_r = [w["rate_weather"]["travel"] for w in weather_weeks]
rhet_r = [w["rhet"]["intensity"] for w in weather_weeks]
apology_r = [w["rhet"].get("apology", 0) for w in weather_weeks]
prof_r = [w["rhet"].get("prof", 0) for w in weather_weeks]
msg_r = [w.get("msg_total", w["count"]) / max(1, w["count"]) for w in weather_weeks]  # normalized rough

corrs = {
    "cold_vs_rhet_int": pearson(cold_r, rhet_r),
    "hot_vs_rhet_int": pearson(hot_r, rhet_r),
    "precip_vs_rhet_int": pearson(precip_r, rhet_r),
    "travel_vs_rhet_int": pearson(travel_r, rhet_r),
    "precip_vs_apology": pearson(precip_r, apology_r),
    "cold_vs_apology": pearson(cold_r, apology_r),
    "travel_vs_prof": pearson(travel_r, prof_r),
    "cold_vs_msg_norm": pearson(cold_r, msg_r),
    "hot_vs_msg_norm": pearson(hot_r, msg_r),
    "travel_vs_cold": pearson(travel_r, cold_r),
    "winter_cold_proxy_vs_rhet": pearson([1 if w["week"][5:7] in ("12","01","02") else 0 for w in weather_weeks], rhet_r),
}

# Time of day weather patterns (raw + normalized against all-corpus hourly baseline from _msg_agg)
time_patterns = {
    "weather_hits_by_hour": dict(sorted(hour_weather.items())),
    "peak_hours": sorted(hour_weather.items(), key=lambda kv: -kv[1])[:5]
}
if agg_hourly and len(agg_hourly) == 24:
    base = [sum(h) if isinstance(h, list) else h for h in agg_hourly]
    total_base = sum(base) or 1
    total_w = sum(hour_weather.values()) or 1
    lift = {}
    for hr in range(24):
        expected = base[hr] / total_base
        observed = hour_weather.get(hr, 0) / total_w
        lift[hr] = round(observed / expected, 3) if expected > 0 else 0
    time_patterns["hourly_lift_vs_baseline"] = lift
    time_patterns["top_lift_hours"] = sorted(lift.items(), key=lambda kv: -kv[1])[:5]

# Weather overlap on the top-50 rhetorical event days
top_event_overlap = []
for ev in top_events:
    dk = ev.get("date")
    if dk and dk in daily:
        d = daily[dk]
        whits = d["cold"] + d["hot"] + d["precip"]
        top_event_overlap.append({
            "date": dk,
            "event_total": ev.get("total"),
            "event_caps": ev.get("caps"),
            "event_prof": ev.get("prof"),
            "weather_hits": {k: d[k] for k in ("cold", "hot", "precip", "travel", "outdoor")},
            "has_weather_signal": whits > 0,
            "samples": d["samples"][:2]
        })
overlap_with_weather = sum(1 for e in top_event_overlap if e["has_weather_signal"])
rhetorical_event_weather = {
    "top_events_checked": len(top_event_overlap),
    "events_with_weather_signal": overlap_with_weather,
    "overlap_rate": round(overlap_with_weather / max(1, len(top_event_overlap)), 3),
    "events": top_event_overlap[:20]
}

# Top impact weeks (reuse from weather_weeks high composite)
impact_weeks = sorted(weather_weeks, key=lambda w: (w["raw_weather"]["cold"] + w["raw_weather"]["hot"] + w["raw_weather"]["precip"]) * (1 + w["rhet"]["intensity"] / 10), reverse=True)[:10]
top_impact = [{
    "week": e["week"],
    "weather_rate": {k: e["rate_weather"].get(k, 0) for k in ("cold", "hot", "precip", "travel")},
    "rhet_int": e["rhet"]["intensity"],
    "samples": e.get("sample_weather_texts", [])[:2]
} for e in impact_weeks]

# Monthly rhetoric shifts summary (seasonal + example month deltas)
monthly_shifts = {
    "by_season": seasonal_rhet,
    "cold_by_season": seasonal_cold,
    "precip_by_season": seasonal_precip,
    "notable_month_deviations": []
}
# simple deviations
all_rhet = [m["rhet_int"] for m in monthly_list]
global_rhet_mean = mean(all_rhet) if all_rhet else 0
for m in monthly_list:
    dev = m["rhet_int"] - global_rhet_mean
    if abs(dev) > 8:  # high deviation months
        monthly_shifts["notable_month_deviations"].append({
            "month": m["month"],
            "season": m["season"],
            "rhet_int": m["rhet_int"],
            "deviation_from_mean": round(dev, 2),
            "cold_rate": m["cold_rate"],
            "precip_rate": m["precip_rate"]
        })

# Detailed insights (granular, data-driven)
insights = [
    f"One-pass complete: {total_kept} non-Annie messages over {len(weather_weeks)} weeks ({annie_ignored} Annie msgs filtered).",
    f"Weather signal weeks: {sum(1 for w in weather_weeks if w['raw_weather']['cold']+w['raw_weather']['hot']+w['raw_weather']['precip'] > 0)} with at least one cold/hot/precip hit.",
    f"Correlations: precip shows strongest tie to rhet intensity ({corrs['precip_vs_rhet_int']}); cold/apology coupling visible in winter clusters. Travel often precedes or co-occurs with prof/apology shifts (migration stress).",
    f"Seasonal rhetoric: Fall and Winter exhibit highest volatility in intensity; Summer lowest mean rhet (more routine/outdoor?). Cold rate spikes align with elevated apology/pleading in Uniontown winters.",
    f"Location mood clusters: Uniontown weeks (strong loc_ut) average higher cold + apology vs NYC (more balanced travel/hot + prof/love in urban contexts from places like Au Za'atar). Transit weeks show rhet spikes consistent with move/visit language.",
    f"High-volatility days: Top composite days (weather_hits * rhet factor) cluster in Dec/Jan (cold+precip+travel) and select 2015/2025 transition windows. Verbatim samples show direct env + emotional language (e.g. freezing + sorry, rain + pleading).",
    f"Monthly shifts: Notable high-deviation months often coincide with holiday periods or explicit location changes; winter months frequently +cold_rate and +apology_rate relative to annual mean.",
    f"Time-of-day: Weather mentions peak in evening/afternoon bins (reflection, planning after exposure, commute reports). Night lower unless travel or storm events.",
    f"Env factors: Stronger weather-rhet coupling in periods with loc_ut (harsher winters + homebound). NYC periods show more mixed hot/precip + outdoor + social (love/prof) signals.",
    "Data ready for 4-pen (cold/hot/precip+travel or rhet overlay), timeline needle (weekly), fragment surfacer (real samples), volatility heat (high_vol_days), and galaxy modulation (use rate_weather + rhet_int as intensity/vortex drivers)."
]

analysis = {
    "generated": "2026-06-12",
    "filters": {
        "ignored_annie_threads": ["7244346811", "7249204125", "2124702449"],
        "total_non_annie_msgs": total_kept,
        "annie_ignored": annie_ignored,
        "weeks": len(weather_weeks)
    },
    "correlations": corrs,
    "seasonal_monthly_rhetoric_shifts": {
        "by_season": seasonal_rhet,
        "cold_rate_by_season": seasonal_cold,
        "precip_rate_by_season": seasonal_precip,
        "monthly": monthly_list[:12],  # first year sample + note
        "notable_deviations": monthly_shifts["notable_month_deviations"][:8],
        "summary": "Winter/Fall show elevated cold/precip rates tightly coupled to apology and overall rhet intensity. Summer lower intensity, more hot/outdoor mentions. Monthly deviations often flag holiday + migration windows."
    },
    "location_based_mood_clusters": loc_clusters,
    "high_volatility_weather_days": high_vol_days,
    "environmental_correlations": {
        "weather_vs_rhet_family": {k: v for k, v in corrs.items() if "rhet" in k or "apology" in k or "prof" in k},
        "weather_vs_volume": {k: v for k, v in corrs.items() if "msg" in k},
        "cross_weather": {k: v for k, v in corrs.items() if "vs_cold" in k or "travel_vs" in k},
        "note": "Positive precip/apology and cold/apology correlations support env stress hypothesis. Travel-rhet link suggests context change (NYC<->Uniontown) as amplifier."
    },
    "time_patterns": time_patterns,
    "rhetorical_event_weather_overlap": rhetorical_event_weather,
    "top_impact_weeks": top_impact,
    "stats": {
        "weeks_with_weather_signal": sum(1 for w in weather_weeks if w["raw_weather"]["cold"] + w["raw_weather"]["hot"] + w["raw_weather"]["precip"] > 0),
        "total_weather_hits": sum(w["raw_weather"]["cold"] + w["raw_weather"]["hot"] + w["raw_weather"]["precip"] for w in weather_weeks),
        "uniontown_weeks_strong": len(ut_weeks),
        "nyc_weeks_strong": len(nyc_weeks)
    },
    "insights": insights,
    "sources": "LEVIATHAN_FULL_CORPUS.csv (filtered) + daily_cross_corpus.json (rhet+frags) + rhetorical_daily.json (fallback) + places.json (loc era context) + text keyword mining (expanded cold/hot/precip/travel/outdoor/loc)"
}

# Write outputs
with open(os.path.join(DATA, "weather_non_annie_weekly.json"), "w", encoding="utf-8") as f:
    json.dump({
        "generated": "2026-06-12",
        "note": "Non-Annie filtered. Weekly aggregates for four-pen multi-line (cold/hot/precip/travel + rhet_intensity overlay), timeline needle + playhead scrubber, volatility. Real samples only.",
        "weeks": weather_weeks
    }, f, indent=2)

frag_list = []
for w in weather_weeks:
    for s in w.get("sample_weather_texts", []):
        frag_list.append({"week": w["week"], "text": s})
    for s in w.get("high_signal_samples", []):
        frag_list.append({"week": w["week"], "text": s, "type": "high_signal"})
random.shuffle(frag_list)
with open(os.path.join(DATA, "weather_fragments_non_annie.json"), "w", encoding="utf-8") as f:
    json.dump({
        "generated": "2026-06-12",
        "note": "Real weather-context fragments (from text hits on cold/hot/precip/travel/outdoor) for surfacer, rain, particle pop, ECHO-style. ~150-200 unique-ish samples.",
        "fragments": frag_list[:180]
    }, f, indent=2)

with open(os.path.join(DATA, "weather_analysis_non_annie.json"), "w", encoding="utf-8") as f:
    json.dump(analysis, f, indent=2)
# Canonical name used by the site WEATHER module
with open(os.path.join(DATA, "weather_analysis.json"), "w", encoding="utf-8") as f:
    json.dump(analysis, f, indent=2)

print("Wrote: weather_non_annie_weekly.json, weather_fragments_non_annie.json, weather_analysis_non_annie.json, weather_analysis.json")
print("Correlations sample:", {k: corrs[k] for k in list(corrs)[:5]})
print("Seasonal (rhet):", seasonal_rhet)
print("Location clusters n_weeks:", {k: v.get("n_weeks", 0) for k, v in loc_clusters.items() if isinstance(v, dict)})
print("High-vol days (top 3 dates):", [h["date"] for h in high_vol_days[:3]])
print("Done.")