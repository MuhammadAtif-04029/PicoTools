@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo.& echo Node.js install nahi hai. https://nodejs.org se "LTS" install karein, phir start.bat dobara chalayein.& echo.& pause& exit /b)
where yt-dlp >nul 2>nul || echo [Note] yt-dlp nahi mila. YouTube/Instagram/TikTok tools ke liye CMD mein chalayein: winget install yt-dlp
where ffmpeg >nul 2>nul || echo [Note] ffmpeg nahi mila. MP3/MP4 ke liye CMD mein chalayein: winget install Gyan.FFmpeg
echo.
echo ToolNest start ho raha hai... Browser apne aap khulega. Band karne ke liye is window ko close karein.
node server.cjs
pause
