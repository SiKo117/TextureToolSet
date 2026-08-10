#!/usr/bin/env bash

# ==============================================================================
# RGBA Channel Packer - Linux Desktop Packaging Script (Electron + Bun)
# Generates native Linux .AppImage and .deb installers with ZERO extra system tools
# ==============================================================================

set -e

echo "🚀 Starting RGBA Channel Packer Linux Build Pipeline (Electron + Bun)..."

# 1. Verify / Install Bun
echo "🍞 Checking Bun runtime..."
if ! command -v bun &> /dev/null; then
    echo "Bun is not installed. Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
else
    echo "✓ Bun found: $(bun --version)"
fi

# Navigate to project root directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( dirname "$SCRIPT_DIR" )"
cd "$PROJECT_ROOT"

# 2. Install Electron & Dependencies via Bun
echo "📥 Installing Electron dependencies with Bun..."
bun install

# 3. Build Standalone Linux Desktop Bundles
echo "🛠️ Building Linux Standalone Desktop Application (.AppImage & .deb)..."
bun run build:linux

echo "=============================================================================="
echo "🎉 Linux Desktop Build Completed Successfully!"
echo "Build outputs are located at:"
echo "  • AppImage: $PROJECT_ROOT/dist/RGBA Channel Packer-1.0.0.AppImage"
echo "  • Debian (.deb): $PROJECT_ROOT/dist/rgba-channel-packer_1.0.0_amd64.deb"
echo "=============================================================================="
