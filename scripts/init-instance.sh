#!/bin/bash

# Cloudflare Wallet Instance Initialization Script
# Creates a new standalone project folder with its own D1 database and configuration
# The new instance is a complete copy ready for customization and deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "=============================================="
echo "  Cloudflare Wallet - New Instance Setup"
echo "=============================================="
echo -e "${NC}"

# Check for required tools
command -v wrangler >/dev/null 2>&1 || { echo -e "${RED}Error: wrangler CLI is required but not installed.${NC}" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo -e "${RED}Error: Node.js is required but not installed.${NC}" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo -e "${RED}Error: npm is required but not installed.${NC}" >&2; exit 1; }

# Get script directory (source project)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

# Default values
DEFAULT_THEME="purple"

# Helper function to prompt until a value is entered
prompt_required() {
  local prompt_text="$1"
  local value=""
  while [ -z "$value" ]; do
    read -p "$prompt_text" value
    if [ -z "$value" ]; then
      echo -e "${YELLOW}This field is required. Please enter a value.${NC}" >&2
    fi
  done
  printf '%s' "$value"
}

# Helper function for password prompts (hidden input)
prompt_required_secret() {
  local prompt_text="$1"
  local value=""
  while [ -z "$value" ]; do
    read -sp "$prompt_text" value
    echo "" >&2
    if [ -z "$value" ]; then
      echo -e "${YELLOW}This field is required. Please enter a value.${NC}" >&2
    fi
  done
  printf '%s' "$value"
}

# Prompt for Cloudflare account
echo -e "${YELLOW}Cloudflare Account:${NC}"
echo "  1) Kwang@adappter.xyz"
echo "  2) Primelayer@proton.me (default)"
echo ""
read -p "Select account (1 or 2) [2]: " ACCOUNT_CHOICE
ACCOUNT_CHOICE=${ACCOUNT_CHOICE:-2}

if [ "$ACCOUNT_CHOICE" = "1" ]; then
  CLOUDFLARE_ACCOUNT_ID="325f8b322c30ee0f5460cfdaef82ecf5"
  echo "Using: Kwang@adappter.xyz"
else
  CLOUDFLARE_ACCOUNT_ID="91dc1b5ea710fdd043ebbe0b47b418c0"
  echo "Using: Primelayer@proton.me"
fi
export CLOUDFLARE_ACCOUNT_ID

# Prompt for configuration
echo ""
echo -e "${YELLOW}Instance Configuration:${NC}"
echo ""

INSTANCE_NAME=$(prompt_required "Instance name (e.g., 'mycompany', 'prod', 'client1'): ")

# Sanitize instance name for folder/database naming
INSTANCE_SAFE=$(echo "$INSTANCE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')

# Target directory (sibling to source project)
PARENT_DIR="$(dirname "$SOURCE_DIR")"
TARGET_DIR="${PARENT_DIR}/wallet-${INSTANCE_SAFE}"

read -p "Target directory [${TARGET_DIR}]: " CUSTOM_TARGET
TARGET_DIR=${CUSTOM_TARGET:-$TARGET_DIR}

# Check if target already exists
if [ -d "$TARGET_DIR" ]; then
  echo -e "${YELLOW}Warning: ${TARGET_DIR} already exists.${NC}"
  read -p "Overwrite? This will delete existing files! (y/n): " OVERWRITE
  if [ "$OVERWRITE" != "y" ] && [ "$OVERWRITE" != "Y" ]; then
    echo "Aborted."
    exit 0
  fi
  rm -rf "$TARGET_DIR"
fi

read -p "Cloudflare Pages project name [wallet-${INSTANCE_SAFE}]: " PROJECT_NAME
PROJECT_NAME=${PROJECT_NAME:-wallet-${INSTANCE_SAFE}}

read -p "Organization name (displayed in UI): " ORG_NAME
if [ -z "$ORG_NAME" ]; then
  ORG_NAME="$INSTANCE_NAME"
fi

read -p "Theme (purple/teal/blue/orange/green/rose/slate) [${DEFAULT_THEME}]: " THEME
THEME=${THEME:-$DEFAULT_THEME}

echo ""
echo -e "${YELLOW}WebAuthn Configuration:${NC}"
RP_ID=$(prompt_required "RP ID (your domain, e.g., wallet.example.com): ")

read -p "RP Name (display name) [${ORG_NAME} Wallet]: " RP_NAME
RP_NAME=${RP_NAME:-"${ORG_NAME} Wallet"}

echo ""
echo -e "${YELLOW}Canton Network Configuration:${NC}"
read -p "Splice Host [p2.cantondefi.com]: " SPLICE_HOST
SPLICE_HOST=${SPLICE_HOST:-p2.cantondefi.com}
read -p "Splice Port [443]: " SPLICE_PORT
SPLICE_PORT=${SPLICE_PORT:-443}

read -p "Canton JSON Host [p2-json.cantondefi.com]: " CANTON_JSON_HOST
CANTON_JSON_HOST=${CANTON_JSON_HOST:-p2-json.cantondefi.com}
read -p "Canton JSON Port [443]: " CANTON_JSON_PORT
CANTON_JSON_PORT=${CANTON_JSON_PORT:-443}

read -p "Canton Auth User [ledger-api-user]: " CANTON_AUTH_USER
CANTON_AUTH_USER=${CANTON_AUTH_USER:-ledger-api-user}

read -p "Splice Admin User [app-user]: " SPLICE_ADMIN_USER
SPLICE_ADMIN_USER=${SPLICE_ADMIN_USER:-app-user}

read -p "Canton Auth Audience [https://canton.network.global]: " CANTON_AUTH_AUDIENCE
CANTON_AUTH_AUDIENCE=${CANTON_AUTH_AUDIENCE:-https://canton.network.global}

read -sp "Canton Auth Secret [unsafe]: " CANTON_AUTH_SECRET
echo ""
CANTON_AUTH_SECRET=${CANTON_AUTH_SECRET:-unsafe}

echo ""
echo -e "${YELLOW}Initial Superadmin Account:${NC}"
read -p "Superadmin username [admin]: " SUPERADMIN_USER
SUPERADMIN_USER=${SUPERADMIN_USER:-admin}
read -sp "Superadmin password [admin]: " SUPERADMIN_PASS
echo ""
SUPERADMIN_PASS=${SUPERADMIN_PASS:-admin}

# Confirm settings
echo ""
echo -e "${BLUE}=============================================="
echo "  Configuration Summary"
echo "==============================================${NC}"
echo "Instance Name:     ${INSTANCE_NAME}"
echo "Target Directory:  ${TARGET_DIR}"
echo "Database Name:     wallet-${INSTANCE_SAFE}"
echo "Project Name:      ${PROJECT_NAME}"
echo "Organization:      ${ORG_NAME}"
echo "RP ID:             ${RP_ID}"
echo "Theme:             ${THEME}"
echo "Splice Host:       ${SPLICE_HOST}"
echo "Canton JSON Host:  ${CANTON_JSON_HOST}"
echo "Splice Admin User: ${SPLICE_ADMIN_USER}"
echo "Superadmin User:   ${SUPERADMIN_USER}"
echo ""

read -p "Proceed with these settings? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

DB_NAME="wallet-${INSTANCE_SAFE}"

# Step 1: Copy project files
echo ""
echo -e "${GREEN}[1/7] Copying project files to ${TARGET_DIR}...${NC}"

mkdir -p "$TARGET_DIR"

# Copy files excluding build artifacts, node_modules, and instance-specific configs
rsync -av --progress "$SOURCE_DIR/" "$TARGET_DIR/" \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude '.wrangler' \
  --exclude '*.log' \
  --exclude 'wrangler.toml' \
  --exclude 'wrangler.*.toml' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'coverage' \
  --exclude '.turbo' \
  --exclude '.next' \
  --exclude '.nuxt' \
  --exclude '.output' \
  --exclude '.cache' \
  --exclude 'package-lock.json' \
  2>/dev/null || {
    # Fallback if rsync not available
    echo -e "${YELLOW}rsync not found, using cp...${NC}"
    cp -r "$SOURCE_DIR"/* "$TARGET_DIR/" 2>/dev/null || true
    cp "$SOURCE_DIR"/.* "$TARGET_DIR/" 2>/dev/null || true
    rm -rf "$TARGET_DIR/node_modules" 2>/dev/null || true
    rm -rf "$TARGET_DIR/dist" 2>/dev/null || true
    rm -rf "$TARGET_DIR/.git" 2>/dev/null || true
    rm -rf "$TARGET_DIR/.wrangler" 2>/dev/null || true
    rm -f "$TARGET_DIR/wrangler.toml" 2>/dev/null || true
    rm -f "$TARGET_DIR"/wrangler.*.toml 2>/dev/null || true
    rm -f "$TARGET_DIR/package-lock.json" 2>/dev/null || true
  }

echo -e "${GREEN}Project files copied.${NC}"

# Step 2: Create D1 database
echo ""
echo -e "${GREEN}[2/7] Creating D1 database '${DB_NAME}'...${NC}"

DB_OUTPUT=$(wrangler d1 create "${DB_NAME}" 2>&1) || {
  if echo "$DB_OUTPUT" | grep -q "already exists"; then
    echo -e "${YELLOW}Database '${DB_NAME}' already exists. Getting ID...${NC}"
    DB_ID=$(wrangler d1 list --json 2>/dev/null | grep -A2 "\"name\": \"${DB_NAME}\"" | grep "uuid" | grep -oP '"uuid":\s*"\K[^"]+' || echo "")
    if [ -z "$DB_ID" ]; then
      echo -e "${YELLOW}Could not auto-detect database ID.${NC}"
      read -p "Enter the existing database ID: " DB_ID
    fi
  else
    echo -e "${RED}Failed to create D1 database. Output:${NC}"
    echo "$DB_OUTPUT"
    exit 1
  fi
}

# Extract database ID from output if we just created it
if [ -z "$DB_ID" ]; then
  # Try JSON format first: "database_id": "xxx"
  DB_ID=$(echo "$DB_OUTPUT" | grep -oP '"database_id":\s*"\K[^"]+' || echo "")
fi

if [ -z "$DB_ID" ]; then
  # Try TOML format: database_id = "xxx"
  DB_ID=$(echo "$DB_OUTPUT" | grep -oP 'database_id\s*=\s*"\K[^"]+' || echo "")
fi

if [ -z "$DB_ID" ]; then
  echo -e "${YELLOW}Could not auto-extract database ID. Please find it in the output above.${NC}"
  echo "$DB_OUTPUT"
  read -p "Enter the database ID: " DB_ID
fi

echo -e "${GREEN}Database ID: ${DB_ID}${NC}"

# Step 3: Generate wrangler.toml
echo ""
echo -e "${GREEN}[3/7] Generating wrangler.toml...${NC}"

cat > "$TARGET_DIR/wrangler.toml" << EOF
# Cloudflare Wallet Instance: ${INSTANCE_NAME}
# Generated by init-instance.sh

name = "${PROJECT_NAME}"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "${DB_NAME}"
database_id = "${DB_ID}"

[vars]
SPLICE_HOST = "${SPLICE_HOST}"
SPLICE_PORT = ${SPLICE_PORT}
CANTON_JSON_HOST = "${CANTON_JSON_HOST}"
CANTON_JSON_PORT = ${CANTON_JSON_PORT}
CANTON_AUTH_SECRET = "${CANTON_AUTH_SECRET}"
CANTON_AUTH_USER = "${CANTON_AUTH_USER}"
SPLICE_ADMIN_USER = "${SPLICE_ADMIN_USER}"
CANTON_AUTH_AUDIENCE = "${CANTON_AUTH_AUDIENCE}"
RP_ID = "${RP_ID}"
RP_NAME = "${RP_NAME}"
THEME = "${THEME}"
ORG_NAME = "${ORG_NAME}"
EOF

echo -e "${GREEN}wrangler.toml created.${NC}"

# Step 4: Apply database schema
echo ""
echo -e "${GREEN}[4/7] Applying database schema...${NC}"

wrangler d1 execute "${DB_NAME}" --remote --file="${TARGET_DIR}/schema.sql" || {
  echo -e "${RED}Failed to apply schema. You may need to run this manually:${NC}"
  echo "cd ${TARGET_DIR} && wrangler d1 execute ${DB_NAME} --remote --file=schema.sql"
}

echo -e "${GREEN}Schema applied.${NC}"

# Step 5: Create superadmin user
echo ""
echo -e "${GREEN}[5/7] Creating superadmin user...${NC}"

# Hash password using same algorithm as the app (PBKDF2 with SHA-256, 32 bytes)
PASS_HASH=$(node -e "
const crypto = require('crypto');
const password = process.argv[1];
const salt = crypto.randomBytes(16);
const saltHex = salt.toString('hex');
const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
console.log(saltHex + ':' + hash);
" "$SUPERADMIN_PASS")

USER_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || node -e "console.log(require('crypto').randomUUID())")

wrangler d1 execute "${DB_NAME}" --remote --command="INSERT INTO superadmin_users (id, username, password_hash, is_superadmin, display_name) VALUES ('${USER_ID}', '${SUPERADMIN_USER}', '${PASS_HASH}', 1, 'Super Admin');" 2>/dev/null || {
  echo -e "${YELLOW}Warning: Could not create superadmin user (may already exist).${NC}"
}

echo -e "${GREEN}Superadmin user created.${NC}"

# Step 6: Seed default data
echo ""
echo -e "${GREEN}[6/7] Seeding default assets and RPC endpoints...${NC}"

wrangler d1 execute "${DB_NAME}" --remote --file="${TARGET_DIR}/scripts/seed-data.sql" 2>/dev/null || {
  echo -e "${YELLOW}Warning: Could not seed default data (may already exist).${NC}"
}

echo -e "${GREEN}Default data seeded.${NC}"

# Step 7: Install dependencies
echo ""
echo -e "${GREEN}[7/7] Installing npm dependencies...${NC}"

cd "$TARGET_DIR"
npm install

echo -e "${GREEN}Dependencies installed.${NC}"

# Summary
echo ""
echo -e "${GREEN}=============================================="
echo "  Instance '${INSTANCE_NAME}' Created!"
echo "==============================================${NC}"
echo ""
echo "Location:     ${TARGET_DIR}"
echo "Database:     ${DB_NAME} (${DB_ID})"
echo ""

# Ask if user wants to deploy now
read -p "Deploy to Cloudflare Pages now? (y/n): " DEPLOY_NOW

if [ "$DEPLOY_NOW" = "y" ] || [ "$DEPLOY_NOW" = "Y" ]; then
  echo ""
  echo -e "${GREEN}Building project...${NC}"
  npm run build || {
    echo -e "${RED}Build failed. Fix errors and deploy manually.${NC}"
    exit 1
  }

  echo ""
  echo -e "${GREEN}Deploying to Cloudflare Pages...${NC}"
  wrangler pages deploy dist --project-name="${PROJECT_NAME}" || {
    echo -e "${YELLOW}Deployment may have failed.${NC}"
  }
fi

echo ""
echo -e "${BLUE}=============================================="
echo "  Next Steps"
echo "==============================================${NC}"
echo ""
echo "1. Navigate to your instance:"
echo "   cd ${TARGET_DIR}"
echo ""
echo "2. Customize themes (optional):"
echo "   Edit files in src/themes/"
echo ""
echo "3. Build and deploy:"
echo "   npm run build"
echo "   npm run deploy"
echo ""
echo -e "${YELLOW}Access URLs:${NC}"
echo "Wallet:  https://${RP_ID}"
echo "Admin:   https://${RP_ID}/admin"
echo "Login:   ${SUPERADMIN_USER}"
echo ""
