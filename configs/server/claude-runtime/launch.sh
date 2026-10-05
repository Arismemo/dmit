#!/bin/sh
set -eu
systemctl start claude-desktop.service claude-novnc.socket claude-vnc.socket
systemctl is-active claude-desktop.service
