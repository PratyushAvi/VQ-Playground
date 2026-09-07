#!/usr/bin/env bash
# Build the wasm module for the browser and copy it where the web app imports
# it. Run after any change to crates/vqb-wasm, or after rebasing the fork.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate="$root/vendor/vq-bench/crates/vqb-wasm"

# getrandom 0.3+ needs this cfg to select its browser backend.
( cd "$crate" && RUSTFLAGS='--cfg getrandom_backend="wasm_js"' \
    wasm-pack build --target web --out-dir pkg-web )

# Vendored into the app rather than linked, so `npm run build` needs no Rust
# toolchain and the checked-out web/ is self-contained.
dest="$root/web/src/wasm"
mkdir -p "$dest"
cp "$crate/pkg-web/vqb_wasm.js" "$crate/pkg-web/vqb_wasm.d.ts" "$crate/pkg-web/vqb_wasm_bg.wasm" "$dest/"
echo "copied wasm module -> web/src/wasm/"
