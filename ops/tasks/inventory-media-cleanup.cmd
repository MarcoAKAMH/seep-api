@echo off
cd /d "%~dp0..\.."
if not exist logs mkdir logs
call npm run inventory:media:cleanup >> logs\inventory-media-cleanup.log 2>&1
