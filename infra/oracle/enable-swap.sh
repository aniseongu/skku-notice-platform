#!/usr/bin/env bash
set -euo pipefail
# Run as root. Never reformat or replace an existing non-swap file.
if [[ $(id -u) != 0 ]]; then echo 'Run as root.' >&2; exit 1; fi
if [[ -L /swapfile ]]; then echo '/swapfile is a symlink.' >&2; exit 1; fi
if [[ ! -e /swapfile ]]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
fi
if [[ ! -f /swapfile ]] || [[ $(stat -c %s /swapfile) != 1073741824 ]] || [[ $(blkid -s TYPE -o value /swapfile) != swap ]]; then
  echo 'Existing /swapfile is not the expected 1 GiB swap file.' >&2
  exit 1
fi
chown root:root /swapfile
chmod 600 /swapfile
if ! swapon --show=NAME --noheadings | grep -Fxq /swapfile; then swapon /swapfile; fi
if ! grep -Eq '^/swapfile[[:space:]]' /etc/fstab; then printf '/swapfile none swap sw 0 0\n' >> /etc/fstab; fi
