#!/bin/sh
# Koptic Desktop from this folder, for Mac and Linux (the script version).
# The easy way is the one-file download at https://koptic.vercel.app/download.
# Run it with:   sh install.sh
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

if ! command -v node >/dev/null 2>&1; then
  if [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    echo "Koptic Desktop needs Node.js. Installing it with Homebrew..."
    brew install node || exit 1
  else
    echo "Koptic Desktop needs Node.js. Get the LTS version from https://nodejs.org, install it, then run this again."
    exit 1
  fi
fi

echo "Installing Koptic Desktop (about 150 MB, one time)..."
npm install --no-fund --no-audit || { echo "Install failed. Check your internet connection and try again."; exit 1; }

ELECTRON="$HERE/node_modules/.bin/electron"
if [ "$(uname)" = "Darwin" ]; then
  # A double-clickable launcher on the Desktop.
  LAUNCH="$HOME/Desktop/Koptic.command"
  printf '#!/bin/sh\ncd "%s" && nohup "%s" . >/dev/null 2>&1 &\n' "$HERE" "$ELECTRON" > "$LAUNCH"
  chmod +x "$LAUNCH"
  echo "Done. Open Koptic from Koptic.command on your Desktop."
else
  # An app menu entry.
  mkdir -p "$HOME/.local/share/applications"
  cat > "$HOME/.local/share/applications/koptic.desktop" <<DESKTOP
[Desktop Entry]
Name=Koptic
Comment=Your school work, read straight from Classroom
Exec="$ELECTRON" "$HERE"
Icon=$HERE/icon.png
Type=Application
Categories=Education;
DESKTOP
  echo "Done. Koptic is in your apps menu."
fi

nohup "$ELECTRON" . >/dev/null 2>&1 &
