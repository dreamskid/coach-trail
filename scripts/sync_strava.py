"""
Sync Strava activities to data/strava-activities.json.
Run by GitHub Actions daily, or manually: python scripts/sync_strava.py

Required env vars (stored in GitHub Secrets):
  STRAVA_CLIENT_ID
  STRAVA_CLIENT_SECRET
  STRAVA_REFRESH_TOKEN
"""

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode

STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities"
DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = DATA_DIR / "strava-activities.json"


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
    client_id = os.environ.get("STRAVA_CLIENT_ID")
    client_secret = os.environ.get("STRAVA_CLIENT_SECRET")
    refresh_token = os.environ.get("STRAVA_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        print("[ERROR] Missing Strava credentials in environment variables.")
        print("Required: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN")
        sys.exit(1)

    print("[INFO] Fetching Strava access token...")
    access_token = get_access_token(client_id, client_secret, refresh_token)

    print("[INFO] Fetching activities...")
    activities = fetch_activities(access_token, per_page=30)
    print(f"[INFO] Got {len(activities)} activities")

    simplified = [simplify_activity(a) for a in activities]

    DATA_DIR.mkdir(exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(simplified, f, indent=2, ensure_ascii=False)

    print(f"[OK] Saved {len(simplified)} activities to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
