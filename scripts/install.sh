#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
bun install
bun run build
mkdir -p ~/.local/bin
ln -sf "$PWD/dist/criever" ~/.local/bin/criever
echo "criever installed → ~/.local/bin/criever"
