"""
Generate Garmin Connect tokens for use in CI/CD.
Run once locally, then store the output as GARMINTOKENS GitHub secret.

Usage: python scripts/garmin_auth.py
"""

from garminconnect import Garmin


def main():
    email = input("Garmin email: ").strip()
    password = input("Garmin password: ").strip()

    print("\n[INFO] Logging in (may trigger MFA)...")
    client = Garmin(email, password, return_on_mfa=True)
    result1, result2 = client.login()

    if result1 == "needs_mfa":
        print("[INFO] MFA required. Check your email or Garmin app.")
        mfa_code = input("MFA code: ").strip()
        client.resume_login(result2, mfa_code)
        print("[OK] MFA login successful!")
    else:
        print("[OK] Login successful (no MFA needed)!")

    # Export tokens as base64 string
    token_str = client.garth.dumps()

    print("\n" + "=" * 60)
    print("GARMINTOKENS value to store in GitHub Secrets:")
    print("=" * 60)
    print(token_str)
    print("=" * 60)
    print(f"\nLength: {len(token_str)} chars")
    print("\nSteps:")
    print("1. Copy the token string above")
    print("2. Go to: https://github.com/dreamskid/coach-trail/settings/secrets/actions")
    print("3. Add secret: GARMINTOKENS = <paste the token string>")
    print("\nThe token will be refreshed automatically by garth on each use.")


if __name__ == "__main__":
    main()
