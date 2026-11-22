#!/bin/sh
# Bind-mounted ./data directories are often created by Docker as root. Fix ownership once, then
# run the app as the unprivileged "node" user.
set -e
if [ "$(id -u)" = "0" ]; then
	mkdir -p /data
	if [ "$(stat -c %u /data)" != "$(id -u node)" ]; then
		chown -R node:node /data
	fi
	exec su-exec node "$@"
fi
exec "$@"
