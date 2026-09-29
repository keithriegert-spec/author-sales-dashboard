# Author Sales Dashboard

A password-protected sales dashboard for authors, hosted free on GitHub Pages.

## How it works

- `build.py` reads the sales workbook (one sheet per author: `Week`, `Weekly Sales`).
- Each author gets a username and a random password, stored in `authors.csv`
  (local only, **never committed**).
- Each author's sales are encrypted with AES-256-GCM using a key derived from their
  password (PBKDF2-SHA256, 600,000 iterations) and written to `site/data/`.
  File names are hashes of the username, so the published site shows no author names.
- The browser downloads the author's encrypted file and decrypts it locally with
  their password. The raw spreadsheet is never published.

## Updating the data (weekly)

1. Drop the new `Sales_History_*.xlsx` into this folder.
2. Run `python3 build.py`. New authors are added to `authors.csv` automatically;
   existing authors keep their credentials.
3. Commit and push `site/`. GitHub Actions redeploys in about a minute.

Reset one author's password: `python3 build.py --reset-password "Sheet Name"`.

Preview locally: `python3 -m http.server 8765 --directory site`, then open
http://localhost:8765.

## Requirements

`pip install pandas openpyxl cryptography`
