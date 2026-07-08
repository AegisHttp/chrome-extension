// Inject the script that exposes window.gpgLogin
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function () {
  this.remove();
};
(document.head || document.documentElement).appendChild(script);

function checkMissingNativeHost(errMsg) {
  if (errMsg && (errMsg.includes('No such native application') || errMsg.includes('not found') || errMsg.includes('Native host disconnected'))) {
    if (!document.getElementById('aegis-native-host-missing-popup')) {
      showMissingNativeHostPopup();
    }
  }
}

function showMissingNativeHostPopup() {
  const overlay = document.createElement('div');
  overlay.id = 'aegis-native-host-missing-popup';
  overlay.style.position = 'fixed';
  overlay.style.top = '0'; overlay.style.left = '0';
  overlay.style.width = '100vw'; overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
  overlay.style.zIndex = '9999999';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';

  const dialog = document.createElement('div');
  dialog.style.backgroundColor = '#fff';
  dialog.style.padding = '30px';
  dialog.style.borderRadius = '12px';
  dialog.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
  dialog.style.fontFamily = 'sans-serif';
  dialog.style.maxWidth = '450px';
  dialog.style.textAlign = 'center';

  const icon = document.createElement('div');
  icon.innerHTML = '🚨';
  icon.style.fontSize = '48px';
  icon.style.marginBottom = '15px';
  dialog.appendChild(icon);

  const title = document.createElement('h2');
  title.innerText = 'Aegis Http Native Host Missing';
  title.style.marginTop = '0';
  title.style.color = '#333';
  dialog.appendChild(title);

  const body = document.createElement('p');
  body.innerHTML = 'The GPG Native Messaging Host is required by the Aegis Http extension, but it was not found on your system or the extension lacks permissions to communicate with it.<br><br>Please download and install it from the official releases page:';
  body.style.color = '#555';
  body.style.lineHeight = '1.5';
  dialog.appendChild(body);

  const linkDiv = document.createElement('div');
  linkDiv.style.margin = '20px 0';
  const repoLink = document.createElement('a');
  repoLink.href = 'https://github.com/AegisHttp/native-host-rust/releases';
  repoLink.innerText = 'Download Native Host';
  repoLink.target = '_blank';
  repoLink.style.display = 'inline-block';
  repoLink.style.backgroundColor = '#007BFF';
  repoLink.style.color = '#fff';
  repoLink.style.padding = '10px 20px';
  repoLink.style.textDecoration = 'none';
  repoLink.style.borderRadius = '6px';
  repoLink.style.fontWeight = 'bold';
  linkDiv.appendChild(repoLink);
  dialog.appendChild(linkDiv);

  const closeBtn = document.createElement('button');
  closeBtn.innerText = 'Close';
  closeBtn.style.padding = '8px 16px';
  closeBtn.style.backgroundColor = '#ccc';
  closeBtn.style.border = 'none';
  closeBtn.style.borderRadius = '4px';
  closeBtn.style.cursor = 'pointer';
  closeBtn.onclick = () => document.body.removeChild(overlay);
  dialog.appendChild(closeBtn);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// Listen for custom events from the injected script or Vue app
window.addEventListener('GPG_LOGIN_REQUEST', async (event) => {
  const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
  const challenge = data.challenge;

  try {
    // 1. Ask background for keys
    const keysResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'list-keys' }, resolve);
    });

    if (!keysResponse || keysResponse.status !== 'success') {
      throw new Error(keysResponse?.error || 'Failed to list keys');
    }

    const keys = keysResponse.keys || [];
    if (keys.length === 0) {
      throw new Error('No GPG secret keys found');
    }

    // 2. Ask user which key to use
    const selectedKey = await showKeySelector(keys);
    if (!selectedKey) {
      throw new Error('User cancelled login');
    }

    // 3. Check for encryption subkey
    if (!selectedKey.has_encrypt) {
      const created = await promptCreateSubkey(selectedKey);
      if (!created) {
        throw new Error('Encryption subkey is required to proceed.');
      }
    }

    const email = selectedKey.email;

    // 4. Request signature
    const signResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'sign', text: challenge, email }, resolve);
    });

    if (!signResponse || signResponse.status !== 'success') {
      throw new Error(signResponse?.error || 'Failed to sign');
    }

    // 5. Send back to webpage
    window.dispatchEvent(new CustomEvent('GPG_LOGIN_RESPONSE', {
      detail: JSON.stringify({ status: 'success', signature: signResponse.signature, email: email, public_key: selectedKey.public_key })
    }));

  } catch (err) {
    checkMissingNativeHost(err.message);
    window.dispatchEvent(new CustomEvent('GPG_LOGIN_RESPONSE', {
      detail: JSON.stringify({ status: 'error', error: err.message })
    }));
  }
});

// A simple UI popup injected into the page to select a GPG key with encryption subkey detection
function showKeySelector(keys) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0'; overlay.style.left = '0';
    overlay.style.width = '100vw'; overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';

    const dialog = document.createElement('div');
    dialog.style.backgroundColor = '#fff';
    dialog.style.padding = '20px';
    dialog.style.borderRadius = '8px';
    dialog.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    dialog.style.fontFamily = 'sans-serif';
    dialog.style.minWidth = '320px';
    dialog.style.color = 'black';

    const title = document.createElement('h3');
    title.innerText = 'Select GPG Key to Login';
    title.style.marginTop = '0';
    title.style.color = 'black';
    dialog.appendChild(title);

    const select = document.createElement('select');
    select.style.width = '100%';
    select.style.padding = '8px';
    select.style.marginBottom = '15px';
    keys.forEach((key, idx) => {
      const option = document.createElement('option');
      option.value = idx.toString();
      const suffix = key.has_encrypt ? '' : ' (No Encryption Subkey)';
      option.innerText = key.email + suffix;
      select.appendChild(option);
    });
    dialog.appendChild(select);

    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.justifyContent = 'flex-end';
    btnContainer.style.gap = '10px';

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = 'Cancel';
    cancelBtn.style.padding = '8px 12px';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.onclick = () => {
      document.body.removeChild(overlay);
      resolve(null);
    };

    const confirmBtn = document.createElement('button');
    confirmBtn.innerText = 'Sign';
    confirmBtn.style.padding = '8px 12px';
    confirmBtn.style.backgroundColor = '#007BFF';
    confirmBtn.style.color = '#fff';
    confirmBtn.style.border = 'none';
    confirmBtn.style.borderRadius = '4px';
    confirmBtn.style.cursor = 'pointer';
    confirmBtn.onclick = () => {
      const selectedKey = keys[parseInt(select.value)];
      document.body.removeChild(overlay);
      resolve(selectedKey);
    };

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(confirmBtn);
    dialog.appendChild(btnContainer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

// Injects subkey wizard to automatically append encryption capability via GPG quick-add-key
function promptCreateSubkey(key) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0'; overlay.style.left = '0';
    overlay.style.width = '100vw'; overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';

    const dialog = document.createElement('div');
    dialog.style.backgroundColor = '#fff';
    dialog.style.padding = '25px';
    dialog.style.borderRadius = '10px';
    dialog.style.boxShadow = '0 6px 12px rgba(0,0,0,0.15)';
    dialog.style.fontFamily = 'sans-serif';
    dialog.style.maxWidth = '400px';
    dialog.style.color = 'black';

    const title = document.createElement('h3');
    title.innerText = '🛡️ Encryption Subkey Required';
    title.style.marginTop = '0';
    title.style.color = '#c0392b';
    dialog.appendChild(title);

    const desc = document.createElement('p');
    desc.innerHTML = `The selected GPG key (<strong>${key.email}</strong>) does not have an Encryption subkey, which is required for Aegis Http E2E Encryption.<br><br>Would you like to automatically create one?`;
    desc.style.fontSize = '14px';
    desc.style.color = '#333';
    desc.style.lineHeight = '1.4';
    dialog.appendChild(desc);

    const form = document.createElement('div');
    form.style.margin = '15px 0';
    form.style.textAlign = 'left';

    const algoLabel = document.createElement('label');
    algoLabel.innerText = 'Key Algorithm & Size:';
    algoLabel.style.fontSize = '12px';
    algoLabel.style.fontWeight = 'bold';
    algoLabel.style.display = 'block';
    algoLabel.style.marginBottom = '5px';
    form.appendChild(algoLabel);

    const algoSelect = document.createElement('select');
    algoSelect.style.width = '100%';
    algoSelect.style.padding = '8px';
    algoSelect.style.marginBottom = '15px';

    const algos = [
      { value: 'rsa3072', text: 'RSA 3072-bit (Recommended)' },
      { value: 'rsa4096', text: 'RSA 4096-bit' },
      { value: 'rsa2048', text: 'RSA 2048-bit' },
      { value: 'cv25519', text: 'Curve 25519 (Modern & Fast)' }
    ];
    algos.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.value;
      opt.innerText = a.text;
      algoSelect.appendChild(opt);
    });
    form.appendChild(algoSelect);

    const expLabel = document.createElement('label');
    expLabel.innerText = 'Key Expiration:';
    expLabel.style.fontSize = '12px';
    expLabel.style.fontWeight = 'bold';
    expLabel.style.display = 'block';
    expLabel.style.marginBottom = '5px';
    form.appendChild(expLabel);

    const expSelect = document.createElement('select');
    expSelect.style.width = '100%';
    expSelect.style.padding = '8px';
    expSelect.style.marginBottom = '15px';

    const exps = [
      { value: '0', text: 'Never Expires' },
      { value: '1y', text: '1 Year' },
      { value: '2y', text: '2 Years' },
      { value: '30', text: '30 Days' }
    ];
    exps.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.value;
      opt.innerText = e.text;
      expSelect.appendChild(opt);
    });
    form.appendChild(expSelect);

    dialog.appendChild(form);

    const statusDiv = document.createElement('div');
    statusDiv.style.fontSize = '12px';
    statusDiv.style.color = '#7f8c8d';
    statusDiv.style.marginBottom = '15px';
    statusDiv.style.display = 'none';
    dialog.appendChild(statusDiv);

    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.justifyContent = 'flex-end';
    btnContainer.style.gap = '10px';

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = 'Cancel';
    cancelBtn.style.padding = '8px 12px';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.onclick = () => {
      document.body.removeChild(overlay);
      resolve(false);
    };

    const confirmBtn = document.createElement('button');
    confirmBtn.innerText = 'Create Subkey';
    confirmBtn.style.padding = '8px 12px';
    confirmBtn.style.backgroundColor = '#27ae60';
    confirmBtn.style.color = '#fff';
    confirmBtn.style.border = 'none';
    confirmBtn.style.borderRadius = '4px';
    confirmBtn.style.cursor = 'pointer';
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      statusDiv.style.display = 'block';
      statusDiv.innerHTML = '⌛ <strong>Creating subkey...</strong><br>Please enter your master GPG key passphrase in the system prompt if requested.';

      try {
        const response = await new Promise((resResolve) => {
          chrome.runtime.sendMessage({
            action: 'add-subkey',
            fingerprint: key.fingerprint,
            email: key.email,
            algo: algoSelect.value,
            expire: expSelect.value
          }, resResolve);
        });

        if (response && response.status === 'success') {
          statusDiv.style.color = '#27ae60';
          statusDiv.innerHTML = '✅ <strong>Subkey created successfully!</strong>';
          setTimeout(() => {
            document.body.removeChild(overlay);
            resolve(true);
          }, 1500);
        } else {
          throw new Error(response?.error || 'Unknown GPG error');
        }
      } catch (err) {
        statusDiv.style.color = '#c0392b';
        statusDiv.innerHTML = `❌ <strong>Error:</strong> ${err.message}`;
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    };

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(confirmBtn);
    dialog.appendChild(btnContainer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
};



// Add Decrypt Handler
window.addEventListener('GPG_DECRYPT_REQUEST', async (event) => {
  const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
  const { id, text } = data;

  try {
    const decryptResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'decrypt', text }, (res) => {
        if (chrome.runtime.lastError) resolve({ status: 'error', error: chrome.runtime.lastError.message });
        else if (!res) resolve({ status: 'error', error: 'Background script did not respond. Did you reload the extension in your browser?' });
        else resolve(res);
      });
    });

    window.dispatchEvent(new CustomEvent('GPG_DECRYPT_RESPONSE', {
      detail: JSON.stringify({ id, ...decryptResponse })
    }));
  } catch (err) {
    checkMissingNativeHost(err.message);
    window.dispatchEvent(new CustomEvent('GPG_DECRYPT_RESPONSE', {
      detail: JSON.stringify({ id, status: 'error', error: err.message })
    }));
  }
});
let lastImportedPublicKey = null;

window.addEventListener('GPG_IMPORT_KEY_REQUEST', async (event) => {
  const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
  const { id, text } = data;

  try {
    lastImportedPublicKey = text;
    window.dispatchEvent(new CustomEvent('GPG_IMPORT_KEY_RESPONSE', {
      detail: JSON.stringify({ id, status: 'success', message: 'Key cached in extension memory' })
    }));
  } catch (err) {
    checkMissingNativeHost(err.message);
    window.dispatchEvent(new CustomEvent('GPG_IMPORT_KEY_RESPONSE', {
      detail: JSON.stringify({ id, status: 'error', error: err.message })
    }));
  }
});

window.addEventListener('GPG_ENCRYPT_REQUEST', async (event) => {
  const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
  const { id, text, email } = data;

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ 
        action: 'encrypt', 
        text, 
        email, 
        public_key: lastImportedPublicKey || '' 
      }, resolve);
    });
    window.dispatchEvent(new CustomEvent('GPG_ENCRYPT_RESPONSE', {
      detail: JSON.stringify({ id, ...response })
    }));
  } catch (err) {
    checkMissingNativeHost(err.message);
    window.dispatchEvent(new CustomEvent('GPG_ENCRYPT_RESPONSE', {
      detail: JSON.stringify({ id, status: 'error', error: err.message })
    }));
  }
});

