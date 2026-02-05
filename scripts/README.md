# Cloudflare Wallet - Instance Deployment Scripts

This directory contains scripts for creating and deploying new instances of Cloudflare Wallet.

## Overview

Each instance is a **standalone project folder** with:
- Complete copy of source code (excluding build artifacts)
- Its own `wrangler.toml` configuration
- Its own Cloudflare D1 database
- Independent theme customization

## Quick Start

### Create a New Instance

From the base project directory, run:

```bash
./scripts/init-instance.sh
```

This interactive wizard will:
1. Create a new folder (e.g., `../wallet-mycompany/`)
2. Copy all source files (excluding `node_modules`, `dist`, etc.)
3. Create a new D1 database
4. Generate `wrangler.toml` with your configuration
5. Apply database schema
6. Create initial superadmin user
7. Seed default assets and RPC endpoints
8. Run `npm install`
9. Optionally deploy immediately

### Deploy an Existing Instance

Navigate to your instance directory and run:

```bash
cd ../wallet-mycompany
./scripts/deploy.sh
```

Or manually:

```bash
cd ../wallet-mycompany
npm install  # if needed
npm run build
wrangler pages deploy dist --project-name=wallet-mycompany
```

## Files

| File | Description |
|------|-------------|
| `init-instance.sh` | Creates a new standalone instance folder |
| `deploy.sh` | Builds and deploys the current instance |
| `wrangler.template.toml` | Reference template for wrangler.toml |
| `seed-superadmin.js` | Creates superadmin user (standalone usage) |
| `seed-data.sql` | Default assets and RPC endpoints |

## Instance Structure

After running `init-instance.sh`, you'll have:

```
parent-directory/
├── cloudflare-wallet/          # Base project (this repo)
│   └── scripts/
│       └── init-instance.sh
│
├── wallet-mycompany/           # New instance
│   ├── src/
│   │   └── themes/             # Customize colors here
│   ├── functions/
│   ├── wrangler.toml           # Instance configuration
│   ├── package.json
│   └── ...
│
└── wallet-client2/             # Another instance
    └── ...
```

## Customizing an Instance

### Theme Colors

Edit files in `src/themes/` to customize colors:

```
src/themes/
├── index.css       # Imports all themes
├── purple.css      # Default theme
├── teal.css
├── blue.css
├── orange.css
├── green.css
├── rose.css
└── slate.css
```

Each theme file defines CSS variables like `--primary`, `--accent-bg`, etc.

### Configuration

Edit `wrangler.toml` to change:
- Canton Network endpoints
- WebAuthn settings (RP_ID, RP_NAME)
- UI settings (THEME, ORG_NAME)

## Configuration Reference

### Required Settings

| Setting | Description | Example |
|---------|-------------|---------|
| `RP_ID` | WebAuthn Relying Party ID (your domain) | `wallet.example.com` |
| `SPLICE_HOST` | Canton Splice API host | `p1.cantondefi.com` |
| `CANTON_JSON_HOST` | Canton JSON API host | `p1-json.cantondefi.com` |
| `CANTON_AUTH_SECRET` | Authentication secret | Keep secret! |
| `SPLICE_ADMIN_USER` | Splice admin party name | `app-user` |

### Optional Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `SPLICE_PORT` | `443` | Splice API port |
| `CANTON_JSON_PORT` | `443` | JSON API port |
| `CANTON_AUTH_USER` | `ledger-api-user` | Auth username |
| `THEME` | `purple` | UI theme |
| `ORG_NAME` | Instance name | Organization name in UI |

## Manual Setup (Alternative)

If you prefer manual setup instead of the interactive script:

### 1. Copy Project Files

```bash
mkdir ../wallet-myinstance
rsync -av --exclude='node_modules' --exclude='dist' --exclude='.git' \
  --exclude='wrangler.toml' ./ ../wallet-myinstance/
cd ../wallet-myinstance
```

### 2. Create D1 Database

```bash
wrangler d1 create wallet-myinstance
```

Note the `database_id` from the output.

### 3. Create wrangler.toml

```bash
cp scripts/wrangler.template.toml wrangler.toml
# Edit wrangler.toml with your values
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Apply Database Schema

```bash
wrangler d1 execute wallet-myinstance --remote --file=schema.sql
```

### 6. Create Superadmin User

```bash
node scripts/seed-superadmin.js wallet-myinstance admin mypassword
```

### 7. Seed Default Data

```bash
wrangler d1 execute wallet-myinstance --remote --file=scripts/seed-data.sql
```

### 8. Build and Deploy

```bash
npm run build
wrangler pages deploy dist --project-name=wallet-myinstance
```

## Troubleshooting

### "wrangler: command not found"

Install wrangler globally:
```bash
npm install -g wrangler
```

### "rsync: command not found"

The script will fall back to `cp`. Or install rsync:
```bash
apt-get install rsync  # Debian/Ubuntu
brew install rsync     # macOS
```

### Database creation fails

Make sure you're logged in to Cloudflare:
```bash
wrangler login
```

### Schema application fails

Check if the database exists:
```bash
wrangler d1 list
```

### Superadmin login fails

Verify the user was created:
```bash
wrangler d1 execute wallet-myinstance --remote \
  --command="SELECT * FROM superadmin_users;"
```
