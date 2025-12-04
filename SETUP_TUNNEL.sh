#!/bin/bash

echo "Canton Wallet - Cloudflare Tunnel Setup Script"
echo "================================================"
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "Installing cloudflared..."
    curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    sudo dpkg -i /tmp/cloudflared.deb
    rm /tmp/cloudflared.deb
    echo "✓ cloudflared installed"
else
    echo "✓ cloudflared already installed"
fi

echo ""
echo "Choose tunnel type:"
echo "1) Quick Tunnel (temporary, for testing)"
echo "2) Named Tunnel (persistent, for production)"
read -p "Enter choice (1 or 2): " choice

if [ "$choice" == "1" ]; then
    echo ""
    echo "Starting Quick Tunnel to expose Canton on port 2903..."
    echo "This will give you a temporary URL like: https://random-words-1234.trycloudflare.com"
    echo ""
    echo "IMPORTANT: Copy the URL and update it in:"
    echo "  1. .dev.vars (for local dev)"
    echo "  2. wrangler.toml (for production)"
    echo "  3. Cloudflare Dashboard environment variables (after deploy)"
    echo ""
    echo "Press Ctrl+C to stop the tunnel when done."
    echo ""
    cloudflared tunnel --url http://localhost:2903

elif [ "$choice" == "2" ]; then
    echo ""
    echo "Setting up Named Tunnel..."

    # Login
    echo "Step 1: Login to Cloudflare"
    cloudflared tunnel login

    # Create tunnel
    echo ""
    echo "Step 2: Creating tunnel 'canton-tunnel'"
    cloudflared tunnel create canton-tunnel

    # Get tunnel ID
    TUNNEL_ID=$(cloudflared tunnel list | grep canton-tunnel | awk '{print $1}')

    if [ -z "$TUNNEL_ID" ]; then
        echo "Error: Failed to create tunnel"
        exit 1
    fi

    echo "✓ Tunnel created with ID: $TUNNEL_ID"

    # Create config
    echo ""
    echo "Step 3: Creating tunnel configuration"
    mkdir -p ~/.cloudflared
    cat > ~/.cloudflared/config.yml <<EOF
tunnel: canton-tunnel
credentials-file: ~/.cloudflared/${TUNNEL_ID}.json

ingress:
  - service: http://localhost:2903
EOF

    echo "✓ Configuration created"

    echo ""
    read -p "Enter your domain for the tunnel (e.g., canton.yourdomain.com): " domain

    if [ -n "$domain" ]; then
        echo ""
        echo "Step 4: Routing DNS for $domain"
        cloudflared tunnel route dns canton-tunnel "$domain"
        echo "✓ DNS routed"

        echo ""
        echo "SUCCESS! Your tunnel is ready."
        echo ""
        echo "Next steps:"
        echo "1. Update wrangler.toml with: SPLICE_HOST = \"$domain\""
        echo "2. Run the tunnel: cloudflared tunnel run canton-tunnel"
        echo "3. Or run as a service: sudo cloudflared service install"
        echo ""
    else
        echo ""
        echo "Tunnel created but not routed to a domain."
        echo "You can route it later with:"
        echo "  cloudflared tunnel route dns canton-tunnel <your-domain>"
    fi

else
    echo "Invalid choice"
    exit 1
fi
