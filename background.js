let nativePort = null;
const CHUNK_SIZE = 800 * 1024; // 800KB Limit
const pendingRequests = new Map();
const inboundChunks = new Map();

function getPort() {
  if (!nativePort) {
    nativePort = chrome.runtime.connectNative('com.aegis.http.gpg');
    
    nativePort.onMessage.addListener((msg) => {
      const req = pendingRequests.get(msg.msg_id);
      if (!req) return;

      if (msg.action === "chunk_reply") {
         if (!inboundChunks.has(msg.msg_id)) inboundChunks.set(msg.msg_id, []);
         inboundChunks.get(msg.msg_id)[msg.index] = msg.data;
         return;
      }
      
      if (msg.status === "chunk_received") {
         return; // Acknowledgement
      }

      // Final response compilation
      if (msg.chunked_reply) {
         const chunks = inboundChunks.get(msg.msg_id) || [];
         const joined = chunks.join("");
         inboundChunks.delete(msg.msg_id);
         
         if (msg.action === 'encrypt') msg.encrypted = joined;
         if (msg.action === 'decrypt') msg.decrypted = joined;
         if (msg.action === 'sign') msg.signature = joined;
      }

      pendingRequests.delete(msg.msg_id);
      if (msg.status === "success") {
         req.resolve(msg);
      } else {
         req.reject(new Error(msg.error || "Native Error"));
      }
    });
    
    nativePort.onDisconnect.addListener(() => {
      console.error("Disconnected from native host.", chrome.runtime.lastError);
      const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : "Native host disconnected";
      
      for (const req of pendingRequests.values()) {
        req.reject(new Error(errMsg));
      }
      pendingRequests.clear();
      
      nativePort = null;
    });
  }
  return nativePort;
}

async function sendChunkedNativeMessage(request) {
  const port = getPort();
  const payloadStr = request.text || "";
  const msgId = crypto.randomUUID();
  request.msg_id = msgId;

  return new Promise((resolve, reject) => {
    pendingRequests.set(msgId, { resolve, reject });
    
    if (payloadStr.length < CHUNK_SIZE && !request.chunked) {
      port.postMessage(request);
      return;
    }

    const totalChunks = Math.ceil(payloadStr.length / CHUNK_SIZE);
    
    for (let i = 0; i < totalChunks; i++) {
        const chunkData = payloadStr.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        port.postMessage({ 
            action: 'chunk', msg_id: msgId, index: i, total: totalChunks, data: chunkData 
        });
    }

    delete request.text;
    request.chunked = true;
    port.postMessage(request);
  });
}

const ALLOWED_ACTIONS = ['list-keys', 'sign', 'decrypt', 'encrypt', 'add-subkey'];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (ALLOWED_ACTIONS.includes(request.action)) {
    sendChunkedNativeMessage(request)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ status: 'error', error: err.message || err }));
    return true; // keep alive for async response
  }
});
