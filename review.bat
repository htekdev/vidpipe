@echo off
cd /d C:\Repos\htekdev\video-auto-note-taker
call npm run build
node dist/cli.js review
pause
