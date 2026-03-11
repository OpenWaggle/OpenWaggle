# Homebrew Cask for OpenWaggle
# To use: create a repo OpenWaggle/homebrew-tap, place this at Casks/openwaggle.rb
# Install: brew tap OpenWaggle/tap && brew install --cask --no-quarantine openwaggle
#
# IMPORTANT: version and sha256 must be updated on each release.
# The release workflow's update-dist-repos job automates this.
cask "openwaggle" do
  version "0.2.0-alpha.1"
  sha256 "" # Populated by release workflow

  on_arm do
    url "https://github.com/OpenWaggle/OpenWaggle/releases/download/v#{version}/openwaggle-#{version}-arm64.dmg"
  end

  on_intel do
    url "https://github.com/OpenWaggle/OpenWaggle/releases/download/v#{version}/openwaggle-#{version}-x64.dmg"
  end

  name "OpenWaggle"
  desc "Desktop coding agent with multi-model waggle mode"
  homepage "https://github.com/OpenWaggle/OpenWaggle"

  app "OpenWaggle.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-rd", "com.apple.quarantine", "#{appdir}/OpenWaggle.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/openwaggle",
    "~/Library/Preferences/com.openwaggle.app.plist",
    "~/Library/Logs/openwaggle",
  ]

  caveats <<~EOS
    OpenWaggle is unsigned. On first launch you may need to right-click > Open
    to bypass macOS Gatekeeper. The --no-quarantine flag removes this requirement.
  EOS

  auto_updates true
end
