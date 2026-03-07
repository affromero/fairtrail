#!/bin/sh
set -e
echo "Starting Fairtrail..."
exec node apps/web/server.js
