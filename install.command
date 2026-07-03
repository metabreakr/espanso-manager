#!/bin/bash
# Espanso Manager — Copyright (C) 2026 Jonathan Ruzek
# SPDX-License-Identifier: GPL-3.0-only
#
# Double-click this file in Finder to install/update Espanso Manager on this Mac.
cd "$(dirname "$0")" || exit 1
bash ./install.sh
echo ""
read -n 1 -s -r -p "Press any key to close this window..."
