@echo off
cd /d "%~dp0..\.."
if not exist logs mkdir logs
call npm run inventory:alerts:sync >> logs\inventory-alerts.log 2>&1
call npm run inventory:reorder:drafts >> logs\inventory-alerts.log 2>&1
