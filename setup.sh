#!/bin/bash
# Holded Sync - Setup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
EXPORT_DIR="$SCRIPT_DIR/exports"

echo "==================================="
echo "Holded Sync - Setup"
echo "==================================="

# Create directories
echo "Creating directories..."
mkdir -p "$LOG_DIR" "$EXPORT_DIR"

# Check Node.js version
echo "Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18 or later."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version $NODE_VERSION found. Version 18 or later required."
    exit 1
fi
echo "✓ Node.js $(node -v) found"

# Install dependencies
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

# Check for .env file
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo ""
    echo "⚠️  No .env file found!"
    echo "   Copy .env.example to .env and fill in your API credentials:"
    echo ""
    echo "   cp .env.example .env"
    echo "   nano .env"
    echo ""
fi

# Prompt for scheduling method
echo ""
echo "==================================="
echo "Scheduling Options"
echo "==================================="
echo ""
echo "Choose how to schedule the daily 8 AM sync:"
echo ""
echo "1) Cron (simple, traditional)"
echo "2) Systemd timer (modern, with logging)"
echo "3) Skip (I'll set up scheduling myself)"
echo ""
read -p "Enter choice [1-3]: " SCHEDULE_CHOICE

case $SCHEDULE_CHOICE in
    1)
        # Cron setup
        CRON_CMD="0 8 * * * cd $SCRIPT_DIR && /usr/bin/node src/index.js >> $LOG_DIR/sync.log 2>&1"
        echo ""
        echo "Add this line to your crontab (run 'crontab -e'):"
        echo ""
        echo "$CRON_CMD"
        echo ""
        read -p "Would you like to add it automatically? [y/N]: " ADD_CRON
        if [ "$ADD_CRON" = "y" ] || [ "$ADD_CRON" = "Y" ]; then
            (crontab -l 2>/dev/null | grep -v "holded-sync"; echo "$CRON_CMD") | crontab -
            echo "✓ Cron job added"
        fi
        ;;
    2)
        # Systemd setup
        echo ""
        echo "To set up systemd timer:"
        echo ""
        echo "1. Edit the service file to set your paths:"
        echo "   nano $SCRIPT_DIR/systemd/holded-sync.service"
        echo ""
        echo "2. Copy files to systemd directory:"
        echo "   sudo cp $SCRIPT_DIR/systemd/holded-sync.* /etc/systemd/system/"
        echo ""
        echo "3. Enable and start the timer:"
        echo "   sudo systemctl daemon-reload"
        echo "   sudo systemctl enable holded-sync.timer"
        echo "   sudo systemctl start holded-sync.timer"
        echo ""
        echo "4. Check status:"
        echo "   systemctl list-timers holded-sync.timer"
        ;;
    3)
        echo "Skipping scheduling setup."
        ;;
esac

echo ""
echo "==================================="
echo "Setup Complete!"
echo "==================================="
echo ""
echo "Next steps:"
echo "1. Configure your .env file with API credentials"
echo "2. Test with: npm run sync"
echo "3. Check logs in: $LOG_DIR"
echo ""
echo "Commands:"
echo "  npm run sync           # Full sync"
echo "  npm run sync:products  # Products only"
echo "  npm run sync:sales     # Sales only"
echo "  npm run export         # Excel export only"
echo ""
