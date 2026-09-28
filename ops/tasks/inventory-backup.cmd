@echo off
cd /d "%~dp0..\.."
if not exist logs mkdir logs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\backup-inventory.ps1 >> logs\inventory-backup.log 2>&1
