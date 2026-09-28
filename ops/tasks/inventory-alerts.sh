#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/seep-api
/usr/bin/npm run inventory:alerts:sync
/usr/bin/npm run inventory:reorder:drafts
