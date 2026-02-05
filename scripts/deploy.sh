#!/bin/bash

# Deploy Cloudflare Wallet instance to Cloudflare Pages
# Usage: ./scripts/deploy.sh
# Run this from within an instance directory (created by init-instance.sh)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get current directory
PROJECT_DIR="$(pwd)"

# Check if wrangler.toml exists
if [ ! -f "wrangler.toml" ]; then
  echo -e "${RED}Error: wrangler.toml not found in current directory.${NC}"
  echo ""
  echo "Make sure you're running this from an instance directory."
  echo "Instance directories are created by: ./scripts/init-instance.sh"
  exit 1
fi

# Extract project name from config
PROJECT_NAME=$(grep -oP '^name\s*=\s*"\K[^"]+' wrangler.toml || echo "")
if [ -z "$PROJECT_NAME" ]; then
  echo -e "${RED}Error: Could not extract project name from wrangler.toml${NC}"
  exit 1
fi

echo -e "${GREEN}=============================================="
echo "  Cloudflare Wallet - Deploy"
echo "==============================================${NC}"
echo ""
echo "Project: ${PROJECT_NAME}"
echo "Directory: ${PROJECT_DIR}"
echo ""

# Check if node_modules exists, if not run npm install
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}node_modules not found. Running npm install...${NC}"
  npm install
  echo ""
fi

# Build
echo -e "${GREEN}Building...${NC}"
npm run build

if [ ! -d "dist" ]; then
  echo -e "${RED}Error: Build failed - dist directory not found${NC}"
  exit 1
fi

# Deploy
echo ""
echo -e "${GREEN}Deploying to Cloudflare Pages...${NC}"

wrangler pages deploy dist --project-name="$PROJECT_NAME"
DEPLOY_STATUS=$?

if [ $DEPLOY_STATUS -eq 0 ]; then
  echo ""
  echo -e "${GREEN}=============================================="
  echo "  Deployed successfully!"
  echo "==============================================${NC}"

  # Try to get the RP_ID for the URL
  RP_ID=$(grep -oP '^RP_ID\s*=\s*"\K[^"]+' wrangler.toml || echo "")
  if [ -n "$RP_ID" ]; then
    echo ""
    echo "Wallet:  https://${RP_ID}"
    echo "Admin:   https://${RP_ID}/admin"
  fi
else
  echo ""
  echo -e "${RED}Deployment failed${NC}"
  exit 1
fi
