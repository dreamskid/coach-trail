"""
Sync Garmin Connect wellness data to data/garmin-wellness.json.
Run by GitHub Actions daily, or manually: python scripts/sync_garmin.py

Auth: uses GARMINTOKENS env var (base64 token string from garth).
Garmin MFA makes email/password login impossible in CI.
To generate tokens: python scripts/garmin_auth.py

Fallback: GARMIN_EMAIL + GARMIN_PASSWORD (only works without MFA).
"""

import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = DATA_DIR / "garmin-wellness.json"
DAYS = 14


def login():
    """Authenticate to Garmin Connect. Returns Garmin() client."""
    from garminconnect import Garmin

    tokens = os.environ.get("GARMINTOKENS")
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")

    if tokens:
        print("[INFO] Using saved token store...")
        client = Garmin()
        client.login(tokenstore=tokens)
        return client

    if email and password:
        print("[INFO] Using email/password login...")
        client = Garmin(email, password)
        client.login()
        return client

    print("[ERROR] No auth method available.")
    print("Set GARMINTOKENS (recommended) or GARMIN_EMAIL + GARMIN_PASSWORD.")
    print("Run: python scripts/garmin_auth.py to generate tokens.")
    sys.exit(1)


def fetch_day_stats(client, day_str):
    """Fetch daily stats (steps, calories, active minutes)."""
    try:
        stats = client.get_stats(day_str)
        return {
            "steps": stats.get("totalSteps", 0),
            "calories": stats.get("totalKilocalories", 0),
            "active_minutes": stats.get("activeSeconds", 0) // 60 if stats.get("activeSeconds") else 0,
        }
    except Exception as e:
        print(f"  [WARN] get_stats({day_str}): {e}")
        return {"steps": 0, "calories": 0, "active_minutes": 0}


def fetch_sleep(client, day_str):
    """Fetch sleep data for a given day."""
    try:
        data = client.get_sleep_data(day_str)
        daily = data.get("dailySleepDTO", {})
        return {
            "duration_seconds": daily.get("sleepTimeSeconds", 0),
            "deep_seconds": daily.get("deepSleepSeconds", 0),
            "light_seconds": daily.get("lightSleepSeconds", 0),
            "rem_seconds": daily.get("remSleepSeconds", 0),
            "awake_seconds": daily.get("awakeSleepSeconds", 0),
            "score": daily.get("sleepScores", {}).get("overall", {}).get("value", 0)
            if isinstance(daily.get("sleepScores"), dict) else 0,
        }
    except Exception as e:
        print(f"  [WARN] get_sleep_data({day_str}): {e}")
        return None


def fetch_body_battery(client, day_str):
    """Fetch Body Battery data for a given day."""
    try:
        data = client.get_body_battery(day_str)
        if not data:
            return None

        # Response can be a list of day objects or a single dict
        day_obj = data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else None
        if not day_obj or not isinstance(day_obj, dict):
            return None

        # Extract values from bodyBatteryValuesArray [[timestamp, level], ...]
        bb_array = day_obj.get("bodyBatteryValuesArray", [])
        values = []
        for r in bb_array:
            if isinstance(r, list) and len(r) > 1 and r[1] is not None and r[1] > 0:
                values.append(r[1])
            elif isinstance(r, dict):
                val = r.get("bodyBatteryLevel")
                if val is not None and val > 0:
                    values.append(val)

        if not values:
            return None

        return {
            "highest": max(values),
            "lowest": min(values),
            "charged": day_obj.get("charged", 0),
            "drained": day_obj.get("drained", 0),
        }
    except Exception as e:
        print(f"  [WARN] get_body_battery({day_str}): {e}")
        return None


def fetch_resting_hr(client, day_str):
    """Fetch resting heart rate for a given day."""
    try:
        data = client.get_rhr_day(day_str)
        if not data:
            return None
        if isinstance(data, dict):
            for key in ("restingHeartRate", "currentDayRestingHeartRate"):
                val = data.get(key)
                if val:
                    return val
            metrics = data.get("allMetrics", {}).get("metricsMap", {})
            rhr_list = metrics.get("WELLNESS_RESTING_HEART_RATE", [])
            if rhr_list and isinstance(rhr_list, list):
                for entry in rhr_list:
                    val = entry.get("value")
                    if val:
                        return int(val)
        return None
    except Exception as e:
        print(f"  [WARN] get_rhr_day({day_str}): {e}")
        return None


def fetch_hrv(client, day_str):
    """Fetch HRV data for a given day."""
    try:
        data = client.get_hrv_data(day_str)
        if not data:
            return None
        summary = data.get("hrvSummary", data) if isinstance(data, dict) else {}
        if not isinstance(summary, dict):
            return None
        return {
            "weekly_avg": summary.get("weeklyAvg", 0),
            "last_night_avg": summary.get("lastNightAvg", 0),
            "last_night_5_min_high": summary.get("lastNight5MinHigh", 0),
            "baseline_low": summary.get("baselineLowUpper", 0),
            "baseline_balanced_low": summary.get("baselineBalancedLow", 0),
            "baseline_balanced_upper": summary.get("baselineBalancedUpper", 0),
            "status": summary.get("status", summary.get("currentStatusPhrase", "UNKNOWN")),
        }
    except Exception as e:
        print(f"  [WARN] get_hrv_data({day_str}): {e}")
        return None


def fetch_stress(client, day_str):
    """Fetch stress data for a given day."""
    try:
        data = client.get_stress_data(day_str)
        if not data:
            return None
        if isinstance(data, dict):
            return {
                "avg": data.get("avgStressLevel") or data.get("overallStressLevel") or 0,
                "rest_stress_duration": data.get("restStressDuration", 0),
                "low_stress_duration": data.get("lowStressDuration", 0),
                "medium_stress_duration": data.get("mediumStressDuration", 0),
                "high_stress_duration": data.get("highStressDuration", 0),
            }
        return None
    except Exception as e:
        print(f"  [WARN] get_stress_data({day_str}): {e}")
        return None


def fetch_vo2max(client):
    """Fetch VO2max from max metrics."""
    try:
        today = date.today()
        start = (today - timedelta(days=7)).isoformat()
        end = today.isoformat()

        # Try daily range endpoint first (works with MFA tokens)
        try:
            data = client.connectapi(f"/metrics-service/metrics/maxmet/daily/{start}/{end}")
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        generic = item.get("generic")
                        if generic and isinstance(generic, dict):
                            vo2 = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")
                            if vo2:
                                return round(vo2, 1)
        except Exception:
            pass

        # Fallback: get_max_metrics
        data = client.get_max_metrics(end)
        if not data:
            return None
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    generic = item.get("generic")
                    if generic and isinstance(generic, dict):
                        vo2 = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")
                        if vo2:
                            return round(vo2, 1)
        if isinstance(data, dict):
            vo2 = data.get("vo2MaxValue") or data.get("vo2MaxPreciseValue")
            if vo2:
                return round(vo2, 1)
        return None
    except Exception as e:
        print(f"  [WARN] fetch_vo2max: {e}")
        return None


def main():
    print("[INFO] Logging into Garmin Connect...")
    try:
        client = login()
    except Exception as e:
        print(f"[ERROR] Garmin login failed: {e}")
        print("[INFO] Preserving existing data (if any). Exiting gracefully.")
        sys.exit(0)

    print(f"[INFO] Fetching {DAYS} days of wellness data...")

    today = date.today()
    days_data = []

    vo2max = fetch_vo2max(client)
    print(f"  VO2max: {vo2max}")

    for i in range(DAYS - 1, -1, -1):
        day = today - timedelta(days=i)
        day_str = day.isoformat()
        print(f"  Fetching {day_str}...")

        stats = fetch_day_stats(client, day_str)
        sleep = fetch_sleep(client, day_str)
        bb = fetch_body_battery(client, day_str)
        rhr = fetch_resting_hr(client, day_str)
        hrv = fetch_hrv(client, day_str)
        stress = fetch_stress(client, day_str)

        day_entry = {
            "date": day_str,
            "steps": stats["steps"],
            "calories": stats["calories"],
            "active_minutes": stats["active_minutes"],
            "resting_hr": rhr,
            "vo2max": vo2max,
        }
        if sleep:
            day_entry["sleep"] = sleep
        if bb:
            day_entry["body_battery"] = bb
        if hrv:
            day_entry["hrv"] = hrv
        if stress:
            day_entry["stress"] = stress

        days_data.append(day_entry)

    # Build summary
    sleep_durations = [d["sleep"]["duration_seconds"] for d in days_data if d.get("sleep") and d["sleep"].get("duration_seconds") and d["sleep"]["duration_seconds"] > 0]
    rhr_values = [d["resting_hr"] for d in days_data if d.get("resting_hr")]
    stress_values = [d["stress"]["avg"] for d in days_data if d.get("stress") and d["stress"]["avg"] > 0]
    steps_today = days_data[-1]["steps"] if days_data else 0

    bb_current = None
    for d in reversed(days_data):
        if d.get("body_battery"):
            bb_current = d["body_battery"]["highest"]
            break

    hrv_status = None
    hrv_weekly = None
    for d in reversed(days_data):
        if d.get("hrv"):
            hrv_status = d["hrv"]["status"]
            hrv_weekly = d["hrv"]["weekly_avg"]
            break

    sleep_score = None
    for d in reversed(days_data):
        if d.get("sleep") and d["sleep"].get("score"):
            sleep_score = d["sleep"]["score"]
            break

    summary = {
        "last_sync": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "vo2max": vo2max,
        "resting_hr": rhr_values[-1] if rhr_values else None,
        "resting_hr_avg": round(sum(rhr_values) / len(rhr_values)) if rhr_values else None,
        "sleep_avg_seconds": round(sum(sleep_durations) / len(sleep_durations)) if sleep_durations else None,
        "sleep_score": sleep_score,
        "body_battery_current": bb_current,
        "hrv_status": hrv_status,
        "hrv_weekly_avg": hrv_weekly,
        "stress_avg": round(sum(stress_values) / len(stress_values)) if stress_values else None,
        "steps_today": steps_today,
    }

    output = {"summary": summary, "days": days_data}

    DATA_DIR.mkdir(exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"[OK] Saved {len(days_data)} days of wellness data to {OUTPUT_FILE}")
    print(f"  Summary: VO2max={vo2max}, RHR={summary['resting_hr']}, "
          f"Sleep avg={round(summary['sleep_avg_seconds']/3600, 1) if summary['sleep_avg_seconds'] else '?'}h, "
          f"HRV={hrv_status}, BB={bb_current}, Stress={summary['stress_avg']}")


if __name__ == "__main__":
    main()
