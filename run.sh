#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Reinstala quando requirements.txt muda (o marcador guarda a versão instalada).
if [ ! -x .venv/bin/python ] || ! cmp -s requirements.txt .venv/requirements.installed; then
  command -v uv >/dev/null || { echo "Instale uv para preparar o ambiente Python." >&2; exit 1; }
  export UV_CACHE_DIR="$PWD/.uv-cache"
  [ -x .venv/bin/python ] || uv venv .venv --python python3
  uv pip install --python .venv/bin/python -r requirements.txt
  uv pip install --python .venv/bin/python --no-deps basic-pitch==0.4.0
  cp requirements.txt .venv/requirements.installed
fi

# Em NixOS, wheels Python (numpy, scipy) precisam achar libstdc++ e libz de 64 bits.
if [ -d /nix/store ]; then
  for library in /nix/store/*-gcc-*-lib/lib/libstdc++.so.6 /nix/store/*-zlib-1*/lib/libz.so.1; do
    if [ -f "$library" ] && head -c5 "$library" | od -An -tx1 | grep -q "7f 45 4c 46 02"; then
      case ":${LD_LIBRARY_PATH:-}:" in *":$(dirname "$library"):"*) ;; *)
        export LD_LIBRARY_PATH="$(dirname "$library")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ;;
      esac
    fi
  done
fi

exec .venv/bin/python "${@:-server.py}"
