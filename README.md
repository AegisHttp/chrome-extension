# Aegis Http GPG Login (Google Chrome) | En / [TR](README.tr.md)

![Logo](icons/logo.png)

[![Available in the Chrome Web Store](https://developer.chrome.com/docs/webstore/images/ChromeWebStore_Badge_v2_206x58.png)](https://chromewebstore.google.com/detail/lappbcambkogfmigiphapgjcglafcfnd)

Aegis Http is an autonomous, End-to-End Encrypted (E2E) HTTP gateway extension for Google Chrome. It seamlessly intercepts REST API requests sent by frontend web applications, passing them to the locally running `Aegis Http Native Host` (Rust Daemon) where they are encrypted using PGP before hitting the network.

## Features

- **Transparent Interception:** Intercepts `XMLHttpRequest` transparently; meaning the frontend code doesn't need to know anything about cryptography.
- **Native Security:** Cryptographic private keys NEVER touch the JavaScript context or the browser. It securely communicates via Chrome's Native Messaging API.
- **Auto-Decryption:** Once the server responds with a GPG encrypted tunnel, this extension transparently decrypts and proxies the JSON response back to the original function call automatically.

## Installation

1. Go to `chrome://extensions/`
2. Enable **Developer mode** at the top right.
3. Click **Load unpacked** and select this `/google-chrome-extension` directory.
4. **Make sure your Native Host daemon is installed!** Otherwise, Chrome cannot spawn the necessary background processes. (See root or native host README).

## Files Overview

- `manifest.json`: Uses Manifest v3, defines `nativeMessaging` permissions.
- `background.js`: Persistent Service Worker bridging Content Scripts and the Native Rust Node.
- `content.js`: Injects the `inject.js` code dynamically into the webpage's DOM.
- `inject.js`: Highly privileged override script that patches the `XMLHttpRequest.prototype.send` object.
- `icons/`: High-resolution extension brand icons for the browser UI.
