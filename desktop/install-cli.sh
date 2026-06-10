#!/bin/bash

# This script creates a global 'onedesk' command on macOS to manage the background daemon.

CLI_PATH="/usr/local/bin/onedesk"

cat << 'EOF' > /tmp/onedesk-cli
#!/bin/bash

case "$1" in
    start)
        echo "🚀 Starting OneDesk in the background..."
        open -a "OneDesk"
        ;;
    stop)
        echo "🛑 Stopping OneDesk..."
        pkill -f "OneDesk" || killall "OneDesk" || echo "OneDesk is not running."
        ;;
    uninstall)
        echo "🗑️ Uninstalling OneDesk..."
        pkill -f "OneDesk" 2>/dev/null
        rm -rf "/Applications/OneDesk.app"
        rm -rf ~/Library/Application\ Support/onedesk
        echo "✅ OneDesk has been completely removed."
        ;;
    *)
        echo "OneDesk CLI"
        echo "Usage: onedesk [start | stop | uninstall]"
        ;;
esac
EOF

chmod +x /tmp/onedesk-cli

# Move with sudo if required
if [ -w "/usr/local/bin" ]; then
    mv /tmp/onedesk-cli "$CLI_PATH"
else
    echo "Requesting sudo to install global command to $CLI_PATH..."
    sudo mv /tmp/onedesk-cli "$CLI_PATH"
fi

echo "✅ Global command installed! You can now use 'onedesk start', 'onedesk stop', and 'onedesk uninstall' anywhere."
