const el = (id) => document.getElementById(id);


const debugLogEl = el('debug-log');
function debugLog(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  const lines = debugLogEl.textContent ? debugLogEl.textContent.split('\n') : [];
  lines.push('[' + ts + '] ' + msg);
  while (lines.length > 300) lines.shift();
  debugLogEl.textContent = lines.join('\n');
  debugLogEl.scrollTop = debugLogEl.scrollHeight;
}
el('btn-debug-clear').onclick = () => { debugLogEl.textContent = ''; };

const settingsDialog = el('settings-dialog');
const capturePreview = el('capture-preview');
const capturePlaceholder = el('capture-placeholder');
const btnSolve = el('btn-solve');
const statusEl = el('status');

let currentImage = null;
let activeTab = 'image';
let documents = [];
let docDigest = null;

function loadSettings() {
  return {
    apiKey: localStorage.getItem('apiKey') || '',
    answerModel: localStorage.getItem('answerModel') || '',
    decisionModel: localStorage.getItem('decisionModel') || ''
  };
}
function saveSettings(s) {
  localStorage.setItem('apiKey', s.apiKey);
  localStorage.setItem('answerModel', s.answerModel);
  localStorage.setItem('decisionModel', s.decisionModel);
}

const sourceDialog = el('source-dialog');

function pickSource(type, sources) {
  return new Promise((resolve) => {
    const list = el('source-list');
    list.innerHTML = '';
    el('source-dialog-title').textContent = type === 'window' ? 'Capture which window?' : 'Capture which screen?';
    for (const s of sources) {
      const item = document.createElement('button');
      item.className = 'source-item';
      if (s.thumb) {
        const img = document.createElement('img');
        img.src = s.thumb;
        item.appendChild(img);
      }
      const label = document.createElement('span');
      label.textContent = s.name;
      item.appendChild(label);
      item.onclick = () => {
        sourceDialog.close();
        resolve(s);
      };
      list.appendChild(item);
    }
    sourceDialog.onclose = () => resolve(null);
    sourceDialog.showModal();
  });
}

async function captureSource(type) {
  let sources;
  try {
    sources = type === 'window' ? await window.api.listWindows() : await window.api.listScreens();
  } catch (err) {
    setStatus(`Could not list capturable ${type}s: ${err.message}`, true);
    return;
  }
  if (!sources.length) {
    setStatus(`No capturable ${type} found.`, true);
    return;
  }
  const chosen = await pickSource(type, sources);
  if (!chosen) return;
  await grabFrame(chosen.id, chosen.name);
}

async function grabFrame(sourceId, name) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      }
    });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    await new Promise(r => setTimeout(r, 300));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    setFrame(canvas.toDataURL('image/png'));
    await maybeCrop();
    setStatus(`Captured: ${name}. Click Solve, or Adjust crop.`);
  } catch (err) {
    debugLog('capture FAILED: ' + err.message);
    setStatus(`Capture failed: ${err.message}`, true);
  }
}

function setFrame(dataUrl) {
  debugLog('image set (' + Math.round(dataUrl.length / 1024) + ' KB base64)');
  currentImage = dataUrl;
  capturePreview.src = dataUrl;
  capturePreview.hidden = false;
  capturePlaceholder.hidden = true;
  el('btn-clear-capture').hidden = false;
  updateSolveState();
}


async function optimizeImage(dataUrl) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (isError ? ' error' : '');
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function maybeCrop() {
  if (currentImage) {
    el('btn-recrop').hidden = false;
  }
}

el('btn-source-cancel').onclick = () => sourceDialog.close();

const TABS = ['capture', 'screenshot', 'text'];

function switchTab(tab) {
  if (activeTab !== tab) debugLog('tab switched to ' + tab);
  activeTab = tab;
  for (const t of TABS) {
    el('tab-btn-' + t).classList.toggle('active', t === tab);
    el('tab-' + t).hidden = t !== tab;
  }
  el('capture-preview-wrap').hidden = tab === 'text';
  el('btn-recrop').hidden = tab === 'text' || !currentImage;
  updateSolveState();
}
el('tab-btn-capture').onclick = () => switchTab('capture');
el('tab-btn-screenshot').onclick = () => switchTab('screenshot');
el('tab-btn-text').onclick = () => switchTab('text');

el('btn-clear-capture').onclick = () => {
  debugLog('capture cleared');
  currentImage = null;
  capturePreview.hidden = true;
  capturePreview.src = '';
  capturePlaceholder.hidden = false;
  el('btn-recrop').hidden = true;
  el('btn-clear-capture').hidden = true;
  updateSolveState();
};

function updateSolveState() {
  const imageOk = !!currentImage && activeTab !== 'text';
  const textOk = activeTab !== 'text' || el('manual-question').value.trim().length > 0;
  btnSolve.disabled = !imageOk && !textOk;
}
el('manual-question').addEventListener('input', updateSolveState);

el('btn-capture-screen').onclick = () => captureSource('screen');
el('btn-capture-window').onclick = () => captureSource('window');

el('btn-upload').onclick = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    if (input.files[0]) {
      setFrame(await readFileAsDataUrl(input.files[0]));
      setStatus('Screenshot loaded. Click Solve.');
    }
  };
  input.click();
};

window.addEventListener('paste', async (e) => {
  const item = [...(e.clipboardData.items || [])].find(i => i.type.startsWith('image/'));
  if (item) {
    if (activeTab !== 'screenshot' && activeTab !== 'capture') switchTab('screenshot');
    setFrame(await readFileAsDataUrl(item.getAsFile()));
    setStatus('Pasted image loaded. Click Solve.');
  }
});

el('btn-recrop').onclick = () => {
  const url = currentImage;
  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><title>Crop</title><style>
    body{margin:0;background:#111;color:#eee;font-family:sans-serif}#img{position:absolute;top:0;left:0;cursor:crosshair}#box{position:absolute;border:2px dashed #4c8dff;pointer-events:none;display:none}
    #bar{position:fixed;bottom:0;left:0;right:0;padding:8px;background:#1a2029}button{padding:6px 12px}</style></head>
    <body><img id="img" src="${url}"><div id="box"></div><div id="bar"><button id="ok">Crop selected</button><span>Drag a rectangle around the question.</span></div>
    <script>const img=document.getElementById('img'),box=document.getElementById('box');let sx,sy,drawing=false;
    img.onload=()=>{};document.addEventListener('mousedown',e=>{if(e.target!==img)return;drawing=true;sx=e.pageX;sy=e.pageY;box.style.display='block';});
    document.addEventListener('mousemove',e=>{if(!drawing)return;box.style.left=Math.min(sx,e.pageX)+'px';box.style.top=Math.min(sy,e.pageY)+'px';box.style.width=Math.abs(e.pageX-sx)+'px';box.style.height=Math.abs(e.pageY-sy)+'px';});
    document.addEventListener('mouseup',()=>{drawing=false;});
    document.getElementById('ok').onclick=()=>{if(box.style.display==='none'||box.offsetWidth<10){alert('Drag a selection on the image first.');return;}
    const t={l:box.offsetLeft,t:box.offsetTop,w:box.offsetWidth,h:box.offsetHeight,i:img.naturalWidth/img.clientWidth};
    window.opener.postMessage({crop:t},'*');window.close();};<\/script></body></html>`);
};

window.addEventListener('message', async (e) => {
  const c = e.data && e.data.crop;
  if (!c || !currentImage) return;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = c.w * c.i;
    canvas.height = c.h * c.i;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, c.l * c.i, c.t * c.i, c.w * c.i, c.h * c.i, 0, 0, canvas.width, canvas.height);
    setFrame(canvas.toDataURL('image/png'));
    setStatus('Cropped. Click Solve.');
  };
  img.src = currentImage;
});


el('btn-add-docs').onclick = async () => {
  const docs = await window.api.pickDocument();
  for (const d of docs) documents.push(d);
  docDigest = null;
  renderDocs();
};
el('btn-clear-docs').onclick = () => { documents = []; docDigest = null; renderDocs(); };

el('btn-analyze-docs').onclick = async () => {
  if (!documents.length) return;
  const settings = loadSettings();
  if (!settings.apiKey) {
    setStatus('Add your OpenRouter API key in Settings first.', true);
    settingsDialog.showModal();
    return;
  }
  const btn = el('btn-analyze-docs');
  btn.disabled = true;
  setStatus('Analyzing documents (one-time, may take a minute)…');
  try {
    const res = await window.api.analyzeDocuments({
      apiKey: settings.apiKey,
      answerModel: settings.answerModel,
      documents
    });
    if (!res.ok) throw new Error(res.error);
    docDigest = res.digest;
    debugLog('document digest ready: ' + res.digest.length + ' chars');
    setStatus('Document context ready (' + res.digest.length + ' chars). Solving will use it.');
  } catch (err) {
    debugLog('document analysis FAILED: ' + err.message);
    setStatus('Document analysis failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
    renderDocs();
  }
};

function renderDocs() {
  const list = el('doc-list');
  list.innerHTML = '';
  el('btn-analyze-docs').disabled = documents.length === 0;
  documents.forEach((d, i) => {
    const li = document.createElement('li');
    if (d.error) {
      li.className = 'error';
      li.textContent = `${d.name}: ${d.error}`;
    } else {
      li.textContent = d.name + ` (${Math.round(d.text.length / 1000)}k chars)`;
    }
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.title = 'Remove';
    rm.onclick = () => { documents.splice(i, 1); docDigest = null; renderDocs(); };
    li.appendChild(rm);
    list.appendChild(li);
  });
}

el('btn-solve').onclick = async () => {
  const manualText = el('manual-question').value.trim();
  if (!currentImage && !manualText) return;
  const settings = loadSettings();
  if (!settings.apiKey) {
    setStatus('Add your OpenRouter API key in Settings first.', true);
    settingsDialog.showModal();
    return;
  }
  btnSolve.disabled = true;
  el('results').hidden = true;
  setStatus(useText ? 'Asking the model…' : 'Reading the question with the vision model…');
  try {
    const useText = activeTab === 'text' || (!currentImage && manualText);
    const image = (!useText && currentImage) ? await optimizeImage(currentImage) : null;
    const res = await window.api.solveQuestion({
      image,
      manualText: useText ? manualText : null,
      documents,
      docDigest,
      apiKey: settings.apiKey,
      answerModel: settings.answerModel,
      decisionModel: settings.decisionModel
    });
    if (!res.ok) throw new Error(res.error);
    const t = res.result.timing || {};
    debugLog('answers: ' + (res.result.answers || []).map(a => a.choice + (a.correct ? '✔' : '✘') + ' ' + (typeof a.confidence === 'number' ? (a.confidence * 100).toFixed(0) + '%' : '—')).join(' | '));
    debugLog('timings — answer: ' + t.answerMs + 'ms, decision: ' + t.decisionMs + 'ms, total: ' + t.totalMs + 'ms');
    renderResults(res.result);
    setStatus(res.result.warning || 'Done.', !!res.result.warning);
  } catch (err) {
    debugLog('solve FAILED: ' + err.message);
    setStatus(err.message, true);
  } finally {
    btnSolve.disabled = false;
  }
};

function renderResults(result) {
  const tbody = el('answer-table').querySelector('tbody');
  tbody.innerHTML = '';
  const rows = result.answers || [];
  if (!rows.length) {
    setStatus('Model returned no answers.', true);
    return;
  }
  for (const a of rows) {
    const tr = document.createElement('tr');
    const choice = document.createElement('td');
    choice.textContent = a.choice;
    const correct = document.createElement('td');
    correct.textContent = a.correct ? '✔ correct' : '✘ incorrect';
    correct.className = a.correct ? 'correct' : 'incorrect';
    const conf = document.createElement('td');
    conf.textContent = typeof a.confidence === 'number' ? (a.confidence * 100).toFixed(0) + '%' : (a.confidence ?? '—');
    const expl = document.createElement('td');
    expl.textContent = a.explanation || '';
    tr.append(choice, correct, conf, expl);
    tbody.appendChild(tr);
  }
  el('ocr-text').textContent = result.questionText || '(model returned no question text)';
  el('results').hidden = false;
}

el('btn-settings').onclick = () => {
  const s = loadSettings();
  el('api-key').value = s.apiKey;
  el('answer-model').value = s.answerModel;
  el('decision-model').value = s.decisionModel;
  settingsDialog.showModal();
};
el('btn-settings-save').onclick = () => {
  debugLog('settings saved (answer model: ' + (el('answer-model').value.trim() || 'default') + ', decision model: ' + (el('decision-model').value.trim() || 'default') + ')');
  saveSettings({
    apiKey: el('api-key').value.trim(),
    answerModel: el('answer-model').value.trim(),
    decisionModel: el('decision-model').value.trim()
  });
  settingsDialog.close();
};
el('btn-settings-close').onclick = () => settingsDialog.close();

debugLog('app ready');
