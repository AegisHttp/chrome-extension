// Inject the script that exposes window.gpgLogin
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function() {
  this.remove();
};
(document.head || document.documentElement).appendChild(script);

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

    const emails = keysResponse.emails || [];
    if (emails.length === 0) {
      throw new Error('No GPG secret keys found');
    }

    // 2. Ask user which key to use
    const selectedEmail = showEmailSelector(emails);
    if (!selectedEmail) {
        throw new Error('User cancelled login');
    }

    selectedEmail.then(async (email) => {
        if (!email) {
             window.dispatchEvent(new CustomEvent('GPG_LOGIN_RESPONSE', {
                detail: JSON.stringify({ status: 'error', error: 'User cancelled login' })
             }));
             return;
        }
        
        // 3. Request signature
        const signResponse = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'sign', text: challenge, email }, resolve);
        });
    
        if (!signResponse || signResponse.status !== 'success') {
          throw new Error(signResponse?.error || 'Failed to sign');
        }

        // 3.5 Request public key
        const exportResponse = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'export-key', email }, resolve);
        });

        if (!exportResponse || exportResponse.status !== 'success') {
          throw new Error(exportResponse?.error || 'Failed to export public key');
        }
    
        // 4. Send back to webpage
        window.dispatchEvent(new CustomEvent('GPG_LOGIN_RESPONSE', {
          detail: JSON.stringify({ status: 'success', signature: signResponse.signature, email: email, public_key: exportResponse.public_key })
        }));
    });

  } catch (err) {
    window.dispatchEvent(new CustomEvent('GPG_LOGIN_RESPONSE', {
      detail: JSON.stringify({ status: 'error', error: err.message })
    }));
  }
});

// A simple UI popup injected into the page to select an email
function showEmailSelector(emails) {
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
    dialog.style.minWidth = '300px';

    const title = document.createElement('h3');
    title.innerText = 'Select GPG Key to Login';
    title.style.marginTop = '0';
    title.style.color = 'black';
    dialog.appendChild(title);

    const select = document.createElement('select');
    select.style.width = '100%';
    select.style.padding = '8px';
    select.style.marginBottom = '15px';
    emails.forEach(email => {
      const option = document.createElement('option');
      option.value = email;
      option.innerText = email;
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
      document.body.removeChild(overlay);
      resolve(select.value);
    };

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(confirmBtn);
    dialog.appendChild(btnContainer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}


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
    window.dispatchEvent(new CustomEvent('GPG_DECRYPT_RESPONSE', {
      detail: JSON.stringify({ id, status: 'error', error: err.message })
    }));
  }
});

window.addEventListener('GPG_IMPORT_KEY_REQUEST', async (event) => {
  const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
  const { id, text } = data;
  
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'import-key', text }, resolve);
    });
    window.dispatchEvent(new CustomEvent('GPG_IMPORT_KEY_RESPONSE', {
      detail: JSON.stringify({ id, ...response })
    }));
  } catch (err) {
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
      chrome.runtime.sendMessage({ action: 'encrypt', text, email }, resolve);
    });
    window.dispatchEvent(new CustomEvent('GPG_ENCRYPT_RESPONSE', {
      detail: JSON.stringify({ id, ...response })
    }));
  } catch (err) {
    window.dispatchEvent(new CustomEvent('GPG_ENCRYPT_RESPONSE', {
      detail: JSON.stringify({ id, status: 'error', error: err.message })
    }));
  }
});

