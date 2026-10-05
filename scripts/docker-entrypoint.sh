#!/bin/sh
set -eu

# Committed migrations run under Prisma's deployment lock before serving traffic.
# A migration failure keeps the replacement instance unready.
./node_modules/.bin/prisma migrate deploy
exec node --enable-source-maps dist/main.js
