# Cognizant Timesheet Autofill

A tiny Chrome extension that fills the **Break** and lunch-back **In** columns on your Cognizant Compass timesheet — without touching holiday or weekend rows.

## What it does
For every row in the weekly grid where **In (1st column)** and **Out (4th column)** are already filled in, it sets:
- **Break** → your chosen break-start time (default `12` → `12:00:00PM`)
- **In (middle)** → your chosen break-end time (default `13` → `1:00:00PM`)

Rows where In or Out are empty (holidays, weekends, days off you haven't entered yet) are **left alone**. Rows where Break is already filled are also left alone.

Two buttons:
- **Fill empty rows** — fills only, you review and click Submit yourself
- **Fill & Submit** — fills then clicks Submit for you

## Install (one-time)
1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**
4. Select the `timesheet-autofill` folder
5. (Optional) pin the extension to your toolbar via the puzzle-piece icon

## Use
1. Open your Compass timesheet (the page where In/Out are already populated)
2. Click the extension icon
3. Either click **Fill empty rows** (then visually check + hit Submit yourself), or **Fill & Submit** to do everything

Your break-start / break-end values are remembered between uses.

## Time format
Both `12` / `13` and `12:00:00PM` / `1:00:00PM` work — short numbers are auto-converted to PeopleSoft's `H:MM:SSAM/PM` format.

## Safety
- Only touches rows where In and Out already hold a time value
- Skips rows where Break / middle-In are already filled (won't overwrite)
- Restricted to `compass.talent.cognizant.com` via host permission
- No data leaves your browser — no analytics, no network calls
