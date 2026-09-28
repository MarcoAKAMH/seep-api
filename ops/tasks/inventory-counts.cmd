@echo off
cd /d "%~dp0..\.."
if not exist logs mkdir logs
call npm run inventory:counts:weekly >> logs\inventory-counts.log 2>&1
