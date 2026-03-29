window.gpgLogin = function(challenge) {
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      window.removeEventListener('GPG_LOGIN_RESPONSE', listener);
      const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
      if (data.status === 'success') {
        const sessionToken = crypto.randomUUID();
        sessionStorage.setItem('gpg_global_session_token', sessionToken);
        resolve({ signature: data.signature, email: data.email, public_key: data.public_key, session_token: sessionToken });
      } else {
        reject(new Error(data.error));
      }
    };
    window.addEventListener('GPG_LOGIN_RESPONSE', listener);
    window.dispatchEvent(new CustomEvent('GPG_LOGIN_REQUEST', { detail: JSON.stringify({ challenge }) }));
  });
};

const GPG_CACHE_KEY = 'gpg_server_cache';

function getServerCache() {
    try { return JSON.parse(sessionStorage.getItem(GPG_CACHE_KEY)) || {}; }
    catch(e) { return {}; }
}

function saveServerCache(cache) {
    sessionStorage.setItem(GPG_CACHE_KEY, JSON.stringify(cache));
}

// Patch fetch to intercept Encrypted Responses transparently
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    let [resource, config] = args;
    const urlString = typeof resource === 'string' ? resource : (resource.url || window.location.href);
    const origin = new URL(urlString, window.location.origin).origin;

    // AUTONOMOUS OUTBOUND E2E ENCRYPTION
    const cache = getServerCache();
    const serverConfig = cache[origin];
    const isTunneling = serverConfig && serverConfig.tunneling === true;
    const originalMethod = (config && config.method || 'GET').toUpperCase();
    const isPostOrPut = (originalMethod === 'POST' || originalMethod === 'PUT' || originalMethod === 'PATCH');
    const hasBody = !!(config && config.body);
    
    // Trigger autonomous encryption if origin is known to support GPG and there's a body or tunneling is on
    if (serverConfig && (isTunneling || (isPostOrPut && hasBody))) {
        let pubkey = serverConfig.pubkey;
        const expires = serverConfig.expires;
        const serverId = serverConfig.id;

        if (!pubkey || Date.now() > expires) {
            console.log("[GPG Extension] Server Public Key missing or expired. Autonomously fetching from Ubuntu Keyserver...");
            try {
                let pkRes = await originalFetch(`http://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&search=${encodeURIComponent(serverId)}`);
                if (!pkRes.ok) {
                    console.warn("[GPG Extension] Keyserver lookup failed. Falling back to origin API...");
                    pkRes = await originalFetch(origin + "/api/server-pubkey");
                }
                
                if (pkRes.ok) {
                    pubkey = await pkRes.text();
                    serverConfig.pubkey = pubkey;
                    serverConfig.expires = Date.now() + 10 * 60 * 1000; // 10 minutes cache
                    saveServerCache(cache);
                    console.log("[GPG Extension] Successfully fetched and cached Server Public Key.");
                } else {
                    console.error("[GPG Extension] Failed to fetch server public key.", pkRes.status);
                }
            } catch (err) {
                console.error("[GPG Extension] Key fetch failed:", err);
            }
        }

        if (pubkey) {
            // Import key into native host cache
            await window.gpgImportKey(pubkey);

            let finalPayload = null;
            let finalMethod = originalMethod;
            let finalResource = resource;

            if (isTunneling) {
                const urlObj = new URL(urlString, window.location.origin);
                finalPayload = JSON.stringify({
                    tunnel_method: originalMethod,
                    tunnel_url: urlObj.pathname + (urlObj.search || ""),
                    tunnel_body: hasBody ? (typeof config.body === 'string' ? (()=>{try{return JSON.parse(config.body)}catch(e){return config.body}})() : config.body) : null
                });
                finalMethod = 'POST';
                finalResource = new URL("/", origin).href; // Universal catch-all root
            } else {
                finalPayload = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
            }
            
            // Add Replay-Attack Guards
            try {
                let payloadObj = JSON.parse(finalPayload);
                if (payloadObj !== null && typeof payloadObj === 'object' && !Array.isArray(payloadObj)) {
                    payloadObj._gpg_timestamp = Date.now();
                    payloadObj._gpg_nonce = crypto.randomUUID();
                    finalPayload = JSON.stringify(payloadObj);
                }
            } catch(e) {}
            
            console.log(`[GPG Extension] Autonomously Encrypting payload (Tunneling: ${isTunneling}) for server: ${serverId}`);
            const encryptedBody = await window.gpgEncrypt(finalPayload, serverId);
            
            if (!config) config = {};
            if (!config.headers) config.headers = {};
            const isHeadersObj = config.headers instanceof Headers;

            args[0] = finalResource;
            args[1] = {
                ...config,
                method: finalMethod,
                body: encryptedBody,
                headers: isHeadersObj ? new Headers(config.headers) : { ...config.headers }
            };

            const targetHeaders = args[1].headers;
            if (targetHeaders instanceof Headers) {
                targetHeaders.set('x-gpg-encrypted', 'true');
                if (isTunneling) targetHeaders.set('x-gpg-tunnel', 'true');
            } else {
                targetHeaders['x-gpg-encrypted'] = 'true';
                if (isTunneling) targetHeaders['x-gpg-tunnel'] = 'true';
            }
        }
    }

    const response = await originalFetch.apply(this, args);
    
    // Discover and cache Server GPG Identity & Capabilities autonomously
    const gpgServerId = response.headers.get('x-gpg-server-id');
    const gpgSupport = response.headers.get('x-gpg-support');
    
    if (gpgServerId || gpgSupport) {
        const currentCache = getServerCache();
        if (!currentCache[origin]) currentCache[origin] = { id: null, pubkey: null, expires: 0, tunneling: false };
        
        const tunnelingHeader = response.headers.get('x-gpg-tunneling');
        if (tunnelingHeader) {
            currentCache[origin].tunneling = (tunnelingHeader === 'true');
        }

        if (gpgServerId && currentCache[origin].id !== gpgServerId) {
            console.log(`[GPG Extension] Discovered Aegis Http Server: ${gpgServerId} at origin ${origin}`);
            currentCache[origin].id = gpgServerId;
        }
        saveServerCache(currentCache);
    }

    // INBOUND E2E DECRYPTION
    const gpgEncryptedKey = response.headers.get('x-gpg-encrypted');
    if (gpgEncryptedKey) {
        const encryptedText = await response.text();
        
        let hasValidToken = false;
        try {
            const clientToken = (config && config.headers && config.headers instanceof Headers) 
                ? config.headers.get('x-gpg-session-token') 
                : (config && config.headers && config.headers['x-gpg-session-token']);
            const cachedToken = sessionStorage.getItem('gpg_global_session_token');
            if (cachedToken && cachedToken === clientToken && clientToken) {
                hasValidToken = true;
            }
        } catch(e) {}

        if (!hasValidToken) {
            console.warn("🚨 [GPG Aegis Http] XSS Decryption Oracle Prevented! Unauthenticated background script fetch detected. Returning raw PGP block.");
            return new Response(encryptedText, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
            });
        }

        try {
            const decryptedText = await window.gpgDecrypt(encryptedText);
            if (decryptedText && decryptedText.status === 'success') {
                return new Response(decryptedText.text, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            } else {
                console.error("[GPG Extension] Decryption failed natively:", decryptedText);
                return new Response(JSON.stringify({ _NATIVE_DECRYPT_ERROR: decryptedText.error, _RAW_CIPHER: encryptedText }), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }
        } catch (err) {
            console.error("[GPG Extension] Decryption error:", err);
            return new Response(JSON.stringify({ _CAUGHT_EXTENSION_ERROR: err.message, _RAW_CIPHER: encryptedText }), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
            });
        }
    }
    
    return response;
};

// Dispatch Login verification via custom event
window.gpgVerifyLogin = function(challenge, email) {
    return new Promise((resolve, reject) => {
        const id = Math.random().toString();
        const listener = (event) => {
            const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
            if (data.id === id) {
                window.removeEventListener('GPG_LOGIN_RESPONSE', listener);
                if (data.status === 'success') {
                    const sessionToken = crypto.randomUUID();
                    sessionStorage.setItem('gpg_global_session_token', sessionToken);
                    resolve({ ...data, session_token: sessionToken });
                } else {
                    reject(new Error(data.error));
                }
            }
        };
        window.addEventListener('GPG_LOGIN_RESPONSE', listener);
        window.postMessage({ type: 'GPG_NATIVE_REQUEST', action: 'login', id, challenge, email }, '*');
    });
};

// --- XHR (XMLHttpRequest) LEGACY INTERCEPTOR ---
(function() {
    const OriginalXHR = window.XMLHttpRequest;

    function LockedXHR() {
        const xhr = new OriginalXHR();
        let _method = '';
        let _url = '';
        let _headers = {};
        
        const proxy = new Proxy(xhr, {
            get(target, prop) {
                if (prop === 'open') {
                    return function(method, url, async, user, pass) {
                        _method = method;
                        _url = url;
                        return target.open(method, url, async, user, pass);
                    };
                }
                if (prop === 'setRequestHeader') {
                    return function(name, value) {
                        _headers[name.toLowerCase()] = value;
                        return target.setRequestHeader(name, value);
                    };
                }
                if (prop === 'send') {
                    return async function(body) {
                        const origin = new URL(_url, window.location.origin).origin;
                        const cache = getServerCache();
                        const serverConfig = cache[origin];
                        
                        let finalBody = body;
                        let isTunneling = false;

                        if (serverConfig && serverConfig.id && serverConfig.pubkey && Date.now() <= serverConfig.expires) {
                            if (serverConfig.tunneling && (_method.toUpperCase() === 'GET' || _method.toUpperCase() === 'DELETE')) {
                                isTunneling = true;
                                finalBody = JSON.stringify({
                                    tunnel_method: _method,
                                    tunnel_url: _url,
                                    tunnel_body: body || null
                                });
                                target.open('POST', _url, true);
                            }

                            if (_headers['x-gpg-encrypt-to'] === 'true' || isTunneling) {
                                try {
                                    let payloadObj = JSON.parse(finalBody || "{}");
                                    payloadObj._gpg_timestamp = Date.now();
                                    payloadObj._gpg_nonce = crypto.randomUUID();
                                    finalBody = JSON.stringify(payloadObj);
                                } catch(e) {}
                                
                                finalBody = await window.gpgEncrypt(finalBody, serverConfig.id);
                                target.setRequestHeader('x-gpg-encrypted', 'true');
                                if (isTunneling) target.setRequestHeader('x-gpg-tunnel', 'true');
                            }
                        }
                        
                        return target.send(finalBody);
                    };
                }
                if (prop === 'addEventListener') {
                    return function(type, listener, options) {
                        if (type === 'load' || type === 'readystatechange') {
                            const wrappedListener = async function(e) {
                                if (target.readyState === 4 && target.getResponseHeader('x-gpg-encrypted')) {
                                    if (!target._gpgDecrypted) {
                                        target._gpgDecrypted = true;
                                        let hasValidToken = false;
                                        try {
                                            const clientToken = _headers['x-gpg-session-token'];
                                            const cachedToken = sessionStorage.getItem('gpg_global_session_token');
                                            if (cachedToken && cachedToken === clientToken && clientToken) {
                                                hasValidToken = true;
                                            }
                                        } catch(e) {}
                                        
                                        if (hasValidToken) {
                                            try {
                                                const decrypted = await window.gpgDecrypt(target.responseText);
                                                Object.defineProperty(target, 'responseText', { writable: true, value: decrypted.text || decrypted });
                                                Object.defineProperty(target, 'response', { writable: true, value: decrypted.text || decrypted });
                                            } catch(err) {
                                                console.error("XHR Decryption Failed", err);
                                            }
                                        } else {
                                            console.warn("🚨 [GPG Aegis Http] XSS Oracle Prevented on XHR!");
                                        }
                                    }
                                }
                                listener.call(target, e);
                            };
                            return target.addEventListener(type, wrappedListener, options);
                        }
                        return target.addEventListener(type, listener, options);
                    };
                }
                
                return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
            },
            set(target, prop, value) {
                if (prop === 'onload' || prop === 'onreadystatechange') {
                    const originalCallback = value;
                    target[prop] = async function(e) {
                        if (target.readyState === 4 && target.getResponseHeader('x-gpg-encrypted')) {
                            if (!target._gpgDecrypted) {
                                target._gpgDecrypted = true;
                                const clientToken = _headers['x-gpg-session-token'];
                                const cache = getServerCache();
                                const origin = new URL(_url, window.location.origin).origin;
                                
                                if (cache[origin] && cache[origin].token === clientToken && clientToken) {
                                    try {
                                        const decrypted = await window.gpgDecrypt(target.responseText);
                                        Object.defineProperty(target, 'responseText', { writable: true, value: decrypted.text || decrypted });
                                        Object.defineProperty(target, 'response', { writable: true, value: decrypted.text || decrypted });
                                    } catch(err) {}
                                } else {
                                    console.warn("🚨 [GPG Aegis Http] XSS Oracle Prevented on XHR!");
                                }
                            }
                        }
                        return originalCallback.apply(this, arguments);
                    };
                    return true;
                }
                target[prop] = value;
                return true;
            }
        });
        
        return proxy;
    }
    
    window.XMLHttpRequest = LockedXHR;
})();

// Dispatch Decryption via custom event to Content Script
window.gpgDecrypt = function(encryptedText) {
    return new Promise((resolve, reject) => {
        const id = Math.random().toString();
        const listener = (event) => {
            const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
            if (data.id === id) {
                window.removeEventListener('GPG_DECRYPT_RESPONSE', listener);
                if (data.status === 'success') {
                    resolve(data);
                } else {
                    reject(new Error(data.error));
                }
            }
        };
        window.addEventListener('GPG_DECRYPT_RESPONSE', listener);
        window.dispatchEvent(new CustomEvent('GPG_DECRYPT_REQUEST', { 
            detail: JSON.stringify({ id, text: encryptedText }) 
        }));
    });
};

window.gpgImportKey = function(publicKeyArmored) {
    return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substring(7);
        const listener = (event) => {
            const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
            if (data.id === id) {
                window.removeEventListener('GPG_IMPORT_KEY_RESPONSE', listener);
                if (data.status === 'success') resolve(data.message);
                else reject(new Error(data.error));
            }
        };
        window.addEventListener('GPG_IMPORT_KEY_RESPONSE', listener);
        window.dispatchEvent(new CustomEvent('GPG_IMPORT_KEY_REQUEST', {
            detail: JSON.stringify({ id, text: publicKeyArmored })
        }));
    });
};

window.gpgEncrypt = function(plaintext, recipientEmail) {
    return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substring(7);
        const listener = (event) => {
            const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
            if (data.id === id) {
                window.removeEventListener('GPG_ENCRYPT_RESPONSE', listener);
                if (data.status === 'success') resolve(data.encrypted);
                else reject(new Error(data.error));
            }
        };
        window.addEventListener('GPG_ENCRYPT_RESPONSE', listener);
        window.dispatchEvent(new CustomEvent('GPG_ENCRYPT_REQUEST', {
            detail: JSON.stringify({ id, text: plaintext, email: recipientEmail })
        }));
    });
};
