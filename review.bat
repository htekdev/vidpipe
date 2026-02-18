@echo off
cd /d C:\Repos\htekdev\video-auto-note-taker
call npm run build
node dist/index.js review
pause
