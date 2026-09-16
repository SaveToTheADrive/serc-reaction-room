#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${BUILD_DIR:-${repo_root}/obs/build}"
obs_libdir="$(pkg-config --variable=libdir libobs 2>/dev/null || true)"
obs_datadir="$(pkg-config --variable=datadir libobs 2>/dev/null || true)"
obs_libdir="${obs_libdir:-/usr/lib}"
obs_datadir="${obs_datadir:-/usr/share/obs}"
plugin_bin_dir="${OBS_PLUGIN_BIN_DIR:-${obs_libdir}/obs-plugins}"
plugin_data_dir="${OBS_PLUGIN_DATA_DIR:-${obs_datadir}/obs-plugins/emoji_reactions}"

if [[ ! -f "${build_dir}/emoji_reactions.so" ]]; then
  cmake -S "${repo_root}/obs" -B "${build_dir}" -G Ninja
  cmake --build "${build_dir}" --parallel
fi

if [[ ! -d "${repo_root}/obs/assets" ]]; then
  echo "Missing plugin assets: ${repo_root}/obs/assets" >&2
  exit 1
fi

echo "Installing OBS plugin binary to ${plugin_bin_dir}"
sudo install -Dm755 "${build_dir}/emoji_reactions.so" \
  "${plugin_bin_dir}/emoji_reactions.so"

echo "Installing reaction SVGs to ${plugin_data_dir}/assets"
sudo install -d "${plugin_data_dir}/assets"
sudo install -m644 "${repo_root}/obs/assets/"*.svg "${plugin_data_dir}/assets/"

echo "Installed Emoji reactions OBS plugin. Restart OBS to load it."
