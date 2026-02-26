"""
Sync Strava activities to data/strava-activities.json.
Run by GitHub Actions daily, or manually: python scripts/sync_strava.py

Multi-athlete: python scripts/sync_strava.py --data-dir data/juliette/

Required env vars (stored in GitHub Secrets):
  STRAVA_CLIENT_ID
  STRAVA_CLIENT_SECRET
  STRAVA_REFRESH_TOKEN
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError

STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities"
STRAVA_ACTIVITY_URL = "https://www.strava.com/api/v3/activities"


def get_access_token(client_id, client_secret, refresh_token):
    """Exchange refresh token for a fresh access token."""
    data = urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode()

    req = Request(STRAVA_TOKEN_URL, data=data, method="POST")
    with urlopen(req) as resp:
        tokens = json.loads(resp.read())

    new_refresh = tokens.get("refresh_token")
    if new_refresh and new_refresh != refresh_token:
        print(f"[INFO] Refresh token updated. Store new value in GitHub Secrets.")
        print(f"[INFO] New refresh token: {new_refresh[:8]}...")

    return tokens["access_token"]


def fetch_activities(access_token, per_page=30):
    """Fetch recent activities from Strava API."""
    params = urlencode({"per_page": per_page, "page": 1})
    url = f"{STRAVA_ACTIVITIES_URL}?{params}"

    req = Request(url, headers={"Authorization": f"Bearer {access_token}"})
    with urlopen(req) as resp:
        return json.loads(resp.read())


def fetch_activity_detail(access_token, activity_id):
    """Fetch detailed data for a single activity (polyline, splits, laps, etc.)."""
    url = f"{STRAVA_ACTIVITY_URL}/{activity_id}"
    req = Request(url, headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urlopen(req) as resp:
            act = json.loads(resp.read())
    except HTTPError as e:
        print(f"[WARN] Failed to fetch detail for {activity_id}: {e.code}")
        return None

    detail = {"id": activity_id}

    # Polyline for map
    map_data = act.get("map", {})
    if map_data.get("summary_polyline"):
        detail["polyline"] = map_data["summary_polyline"]

    # Splits per km
    splits = act.get("splits_metric")
    if splits:
        detail["splits"] = [
            {
                "km": i + 1,
                "moving_time": s.get("moving_time", 0),
                "distance": round(s.get("distance", 0), 1),
                "elevation_difference": round(s.get("elevation_difference", 0), 1),
                "average_heartrate": s.get("average_heartrate"),
                "average_speed": round(s.get("average_speed", 0), 3),
                "pace_zone": s.get("pace_zone"),
            }
            for i, s in enumerate(splits)
        ]

    # Laps
    laps = act.get("laps")
    if laps:
        detail["laps"] = [
            {
                "name": l.get("name", ""),
                "distance": round(l.get("distance", 0), 1),
                "moving_time": l.get("moving_time", 0),
                "average_heartrate": l.get("average_heartrate"),
                "average_speed": round(l.get("average_speed", 0), 3),
                "total_elevation_gain": round(l.get("total_elevation_gain", 0), 1),
            }
            for l in laps
        ]

    # Extra metrics
    if act.get("calories"):
        detail["calories"] = act["calories"]
    if act.get("average_cadence"):
        detail["average_cadence"] = act["average_cadence"]
    if act.get("description"):
        detail["description"] = act["description"]

    # Best efforts (5k, 10k, etc.)
    best_efforts = act.get("best_efforts")
    if best_efforts:
        detail["best_efforts"] = [
            {
                "name": e.get("name", ""),
                "distance": round(e.get("distance", 0), 1),
                "moving_time": e.get("moving_time", 0),
            }
            for e in best_efforts
        ]

    return detail


def sync_activity_details(access_token, activity_ids, details_file):
    """Fetch details for activities not yet in the details file. Incremental."""
    # Load existing details
    existing = {}
    if details_file.exists():
        try:
            existing = json.loads(details_file.read_text())
        except (json.JSONDecodeError, IOError):
            existing = {}

    # Find missing IDs
    missing = [aid for aid in activity_ids if str(aid) not in existing]
    if not missing:
        print(f"[INFO] All {len(activity_ids)} activity details already cached")
        return existing

    print(f"[INFO] Fetching details for {len(missing)} new activities...")
    for i, aid in enumerate(missing):
        detail = fetch_activity_detail(access_token, aid)
        if detail:
            existing[str(aid)] = detail
            print(f"  [{i+1}/{len(missing)}] {aid} OK")
        else:
            print(f"  [{i+1}/{len(missing)}] {aid} SKIPPED")
        # Rate limit: Strava allows 100 req/15min → ~1.5s between calls
        if i < len(missing) - 1:
            time.sleep(1.5)

    # Write updated details
    with open(details_file, "w") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)
    print(f"[OK] Saved {len(existing)} activity details to {details_file}")
    return existing


def simplify_activity(act):
    """Keep only the fields we need for the dashboard."""
    return {
        "id": act["id"],
        "name": act["name"],
        "type": act["type"],
        "sport_type": act.get("sport_type", act["type"]),
        "start_date_local": act["start_date_local"],
        "distance": round(act.get("distance", 0), 1),
        "moving_time": act.get("moving_time", 0),
        "elapsed_time": act.get("elapsed_time", 0),
        "total_elevation_gain": round(act.get("total_elevation_gain", 0), 1),
        "average_speed": round(act.get("average_speed", 0), 3),
        "max_speed": round(act.get("max_speed", 0), 3),
        "average_heartrate": act.get("average_heartrate"),
        "max_heartrate": act.get("max_heartrate"),
        "suffer_score": act.get("suffer_score"),
        "kudos_count": act.get("kudos_count", 0),
    }


def main():
    parser = argparse.ArgumentParser(description="Sync Strava activities")
    parser.add_argument("--data-dir", default=None,
                        help="Output directory (default: data/)")
    args = parser.parse_args()

    data_dir = Path(args.data_dir) if args.data_dir else Path(__file__).parent.parent / "data"
    output_file = data_dir / "strava-activities.json"

    client_id = os.environ.get("STRAVA_CLIENT_ID")
    client_secret = os.environ.get("STRAVA_CLIENT_SECRET")
    refresh_token = os.environ.get("STRAVA_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        print("[ERROR] Missing Strava credentials in environment variables.")
        print("Required: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN")
        sys.exit(1)

    print(f"[INFO] Output dir: {data_dir}")
    print("[INFO] Fetching Strava access token...")
    access_token = get_access_token(client_id, client_secret, refresh_token)

    print("[INFO] Fetching activities...")
    activities = fetch_activities(access_token, per_page=30)
    print(f"[INFO] Got {len(activities)} activities")

    simplified = [simplify_activity(a) for a in activities]

    data_dir.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w") as f:
        json.dump(simplified, f, indent=2, ensure_ascii=False)

    print(f"[OK] Saved {len(simplified)} activities to {output_file}")

    # Fetch detailed data (polyline, splits, laps) for each activity
    details_file = data_dir / "strava-details.json"
    activity_ids = [a["id"] for a in simplified]
    sync_activity_details(access_token, activity_ids, details_file)


if __name__ == "__main__":
    main()
