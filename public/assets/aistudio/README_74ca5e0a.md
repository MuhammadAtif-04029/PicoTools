# ToolNest

A website of online tools with a smoked-glass UI.

| Category | Tools | Where they run |
|---|---|---|
| PDF | Merge, Split, Compress, Rotate, JPG→PDF, PDF→Word, Word→PDF, Unlock | in the browser |
| Image | Compress, Resize, Convert, Remove Background | in the browser |
| YouTube | →MP3, →MP4, Shorts, Thumbnail | `server.js` + yt-dlp + ffmpeg |
| Instagram | Video, Reels | `server.js` + yt-dlp + ffmpeg |
| TikTok | Video, →MP3 | `server.js` + yt-dlp + ffmpeg |

## Run it on your computer (recommended for the downloaders)

1. Install **Node.js 18+**, **ffmpeg** and **yt-dlp** (`pip install -U yt-dlp` or the binary from github.com/yt-dlp/yt-dlp).
2. Windows: double-click **start.bat** (Mac/Linux: `./start.sh`). Or in this folder run: `node server.js`
3. Open **http://localhost:3000** (open the site *through the server*, not by double-clicking the HTML files — the downloader tools need it).

Keep yt-dlp updated (`pip install -U yt-dlp`) — YouTube/Instagram/TikTok change often and old versions stop working.

## Put it online

The Dockerfile installs ffmpeg + yt-dlp. Deploy the folder to any Docker host (Railway, Render, Fly.io, a VPS).
Note: YouTube often blocks datacenter IPs ("confirm you're not a bot"). If that happens, run the server from a home connection instead.

## Tested

Every PDF and image tool was run in a real browser against real files (merge, split, rotate, JPG→PDF, compress light/strong, PDF→Word, Word→PDF, unlock right/wrong password, image compress/resize/convert/remove-background). The downloader pipeline was tested end to end with a stand-in for yt-dlp; it could not be tested against live YouTube/Instagram/TikTok from the build sandbox, so try one link on your own machine after installing yt-dlp.

## Firebase

`firebase.js` stores usage counters and feedback in Realtime Database. Paste `database.rules.json` into Firebase console → Realtime Database → Rules.

## Responsible use

Only download content you own or have permission to use. Downloading from YouTube, Instagram and TikTok can break their terms of service and copyright law. The site asks users to confirm this before every download.
