#!/usr/bin/env python3
"""Build the encrypted author dashboard data.

Reads every sheet of the sales-history workbook (one sheet per author, columns:
Week, Weekly Sales), assigns each author a username + password (kept in
authors.csv, which is NEVER committed), and writes one AES-GCM encrypted file per
author into site/data/. Only the matching password can decrypt a file, so the
published site contains no readable sales data.

Usage:
    python3 build.py                      # uses the newest Sales_History*.xlsx
    python3 build.py path/to/workbook.xlsx
    python3 build.py --reset-password "Keith Riegert"
"""
import base64
import csv
import glob
import hashlib
import json
import os
import secrets
import sys
from datetime import date

import pandas as pd
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

HERE = os.path.dirname(os.path.abspath(__file__))
AUTHORS_CSV = os.path.join(HERE, "authors.csv")
DATA_DIR = os.path.join(HERE, "site", "data")
ITERATIONS = 600_000
ID_PEPPER = "stable-author-dashboard-v1:"  # must match app.js
PW_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def user_file_id(username: str) -> str:
    return hashlib.sha256((ID_PEPPER + username.strip().lower()).encode()).hexdigest()[:32]


def new_password() -> str:
    return "-".join("".join(secrets.choice(PW_ALPHABET) for _ in range(4)) for _ in range(4))


def new_username(name: str, taken: set) -> str:
    base = "".join(c for c in name.lower().replace(" ", ".") if c.isalnum() or c == ".").strip(".")
    u, n = base or "author", 2
    while u in taken:
        u, n = f"{base}{n}", n + 1
    return u


def encrypt(payload: dict, password: str) -> dict:
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    key = kdf.derive(password.encode())
    ct = AESGCM(key).encrypt(iv, json.dumps(payload, separators=(",", ":")).encode(), None)
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITERATIONS,
            "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def read_sheet(df: pd.DataFrame) -> list:
    df = df.iloc[:, :2].copy()
    df.columns = ["week", "units"]
    df["week"] = pd.to_datetime(df["week"], errors="coerce")
    df["units"] = pd.to_numeric(df["units"], errors="coerce")
    df = df.dropna().sort_values("week")
    return [[d.strftime("%Y-%m-%d"), int(round(u))] for d, u in zip(df["week"], df["units"])]


def load_accounts() -> dict:
    if not os.path.exists(AUTHORS_CSV):
        return {}
    with open(AUTHORS_CSV, newline="") as f:
        return {r["sheet_name"]: r for r in csv.DictReader(f)}


def save_accounts(accounts: dict) -> None:
    with open(AUTHORS_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["sheet_name", "display_name", "username", "password"])
        w.writeheader()
        for r in sorted(accounts.values(), key=lambda r: r["sheet_name"]):
            w.writerow(r)
    os.chmod(AUTHORS_CSV, 0o600)


def main(argv: list) -> None:
    reset = set()
    args = []
    it = iter(argv)
    for a in it:
        if a == "--reset-password":
            reset.add(next(it))
        else:
            args.append(a)

    if args:
        workbook = args[0]
    else:
        found = sorted(glob.glob(os.path.join(HERE, "Sales_History*.xlsx")), key=os.path.getmtime)
        if not found:
            sys.exit("No Sales_History*.xlsx found; pass the workbook path.")
        workbook = found[-1]

    sheets = pd.read_excel(workbook, sheet_name=None)
    accounts = load_accounts()
    taken = {r["username"] for r in accounts.values()}
    os.makedirs(DATA_DIR, exist_ok=True)
    written = set()

    for sheet_name, df in sheets.items():
        weeks = read_sheet(df)
        if not weeks:
            print(f"  skip  {sheet_name!r}: no rows")
            continue
        acct = accounts.get(sheet_name)
        if acct is None:
            u = new_username(sheet_name, taken)
            taken.add(u)
            acct = accounts[sheet_name] = {"sheet_name": sheet_name, "display_name": sheet_name.strip(),
                                           "username": u, "password": new_password()}
            print(f"  new   {sheet_name!r}: username {u}")
        elif sheet_name in reset:
            acct["password"] = new_password()
            print(f"  reset {sheet_name!r}: new password issued")

        payload = {"name": acct["display_name"], "weeks": weeks, "built": date.today().isoformat()}
        fid = user_file_id(acct["username"])
        with open(os.path.join(DATA_DIR, fid + ".json"), "w") as f:
            json.dump(encrypt(payload, acct["password"]), f)
        written.add(fid + ".json")
        print(f"  ok    {sheet_name!r}: {len(weeks)} weeks, latest {weeks[-1][0]}")

    # Remove files for authors no longer in the workbook (or whose username changed).
    for fn in os.listdir(DATA_DIR):
        if fn.endswith(".json") and fn not in written:
            os.remove(os.path.join(DATA_DIR, fn))
            print(f"  removed stale {fn}")

    save_accounts(accounts)
    print(f"\nDone. Credentials are in {os.path.relpath(AUTHORS_CSV)} (keep it private).")


if __name__ == "__main__":
    main(sys.argv[1:])
