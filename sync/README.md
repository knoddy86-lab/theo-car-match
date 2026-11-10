# Theo's Car Match — family sync (LAN)

This small server runs on the family Windows PC (WIN11A). It keeps a copy of the cards (names, “Say it like” text, photos and sounds) in a folder on that PC, and it also serves the game itself.

Phones on the same Wi-Fi open the game from this computer (not from GitHub Pages). That way everything stays on your home network, and the browser is not blocked by mixed-content rules (an https website cannot talk to an http computer on the LAN).

Tailscale can be added later for access away from home. Do not use Tailscale Funnel; that would put the server on the public internet.

## What you need

- The family Windows 11 PC (WIN11A), turned on and connected to the home Wi-Fi
- The iPhone on the **same Wi-Fi**
- This `theo-sync` folder (from the GitHub repo, or a zip of this folder)

You do **not** need to install Node.js system-wide if you use the portable `node.exe` steps below.

## Install on WIN11A

1. Copy this whole `theo-sync` folder onto the PC, for example to  
   `C:\Users\Lindsay\Documents\theo-sync`

2. Confirm the folder contains:
   - `server.js`
   - `start.bat`
   - `game\index.html`
   - `game\sounds\` (the mp3 files)

3. Get the portable Node.js program (official build from nodejs.org, used only to run this server):
   - Right-click `get-node.ps1`
   - Choose **Run with PowerShell**
   - If Windows asks, allow the script once
   - This downloads `node\node.exe` into this folder only

4. Open the Windows firewall for home Wi-Fi only:
   - Right-click `install-firewall.bat`
   - Choose **Run as administrator**
   - This allows TCP port **8787** on the **Private** profile only, not on Public networks

5. Double-click `start.bat`. Leave the window open.
   - Write down the **family key** it prints
   - Write down the **Wi-Fi address**, which looks like `http://192.168.x.x:8787/`
   - The key is also saved in `data\family-key.txt`

6. On the iPhone, open Safari or Chrome and go to that Wi-Fi address  
   (`http://192.168.x.x:8787/` — **not** `https://knoddy86-lab.github.io/theo-car-match/`).
   - The phone may say the site is “Not Secure” because it is plain http on your LAN. That is expected.
   - Hold the gear in the game to open Settings
   - Under **Family sync**, type the family key and tap **Sync now**
   - You can do the same on any other phone or computer on the same Wi-Fi, using the same address and key

7. Optional — start the server when you sign in to Windows:
   - Right-click `install-startup.ps1` and choose **Run with PowerShell**
   - After that, you do not need to keep `start.bat` open (a log is written to `logs\server.log`)
   - To remove it later, run `uninstall-startup.ps1`

The PC must be on, signed in (if you use the startup task), and on the same Wi-Fi as the phones whenever you want sync to work.

## After a game update

Replace `game\index.html` and the files in `game\sounds\` with the latest copies from the `theo-car-match` project, then restart the server. Card data in `data\` is left alone.

## GitHub Pages and Tailscale (later)

The public game at `https://knoddy86-lab.github.io/theo-car-match/` cannot talk to this LAN http server (browsers block that mixed content). For away-from-home sync later:

1. Install Tailscale on WIN11A and on the iPhone, signed in to the **same** account
2. In an Administrator terminal on WIN11A, run:  
   `tailscale serve --bg 8787`  
   Use **serve**, not **funnel**, so the address stays inside your tailnet
3. Enable HTTPS certificates in the tailnet if Tailscale asks
4. On the phone you can keep using the `https://<WIN11A>.<tailnet>.ts.net/` address, **or** enter that URL plus the family key in Family sync on the GitHub Pages copy of the game

Until a server URL is entered, the GitHub Pages copy does not sync and does not send any card data.

## If something does not connect

- Confirm the phone and PC are on the same Wi-Fi, and that the PC’s Wi-Fi is set to a **Private** network
- Confirm `start.bat` is still running (or the startup task is installed)
- Confirm you opened `http://192.168.x.x:8787/` and typed the key exactly
- Try the address in the PC’s own browser first: `http://127.0.0.1:8787/`
- Re-run `install-firewall.bat` as administrator if Windows blocked the port

## API (for reference)

- `GET /api/health` — no key; used so the game can see it is on this server
- `GET /api/sync` — list cards (Bearer family key)
- `PUT /api/cards/:id` — save card fields, last-write-wins by `updatedAt`
- `GET` / `PUT` / `DELETE /api/cards/:id/image`, `.../original` and `.../audio` — display photo, original photo, and sound files

Data is stored as files under `data\cards\`. The family key is a long random string created on first run.
