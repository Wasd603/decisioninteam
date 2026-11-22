const el = (id) => document.getElementById(id);

const settingsDialog = el('settings-dialog');
const webview = el('webview');
const capturePreview = el('capture-preview');
const capturePlaceholder = el('capture-placeholder');
const btnSolve = el('btn-solve');
const statusEl = el('status');

let currentImage = null;
let documents = [];

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

async function captureSource(type) {
  const sources = type === 'window'
    ? await window.api.listWindows()
    : await window.api.listScreens();

  if (!sources.length) {
    setStatus(`No capturable ${type} found.`, true);
    return;
  }

  const choice = prompt(
    `Capture which ${type}?\n\n${sources.map((s, i) => `${i + 1}. ${s.name}`).join('\n')}\n\nEnter a number:`
  );
  if (choice === null) return;
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= sources.length) {
    setStatus('Invalid selection.', true);
    return;
  }
  await grabFrame(sources[idx].id, sources[idx].name);
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
    setStatus(`Capture failed: ${err.message}`, true);
  }
}

async function captureWebview() {
  try {
    const image = await webview.capturePage();
    if (image.isEmpty()) throw new Error('empty capture');
    setFrame(image.toDataURL());
    await maybeCrop();
    setStatus('Captured browser page. Click Solve, or Adjust crop.');
  } catch (err) {
    setStatus(`Browser capture failed (${err.message}). Falling back: maximize the page and use Capture screen instead.`, true);
  }
}

function setFrame(dataUrl) {
  currentImage = dataUrl;
  capturePreview.src = dataUrl;
  capturePreview.hidden = false;
  capturePlaceholder.hidden = true;
  btnSolve.disabled = false;
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

el('btn-browser-go').onclick = () => {
  let url = el('browser-url').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  webview.loadURL(url);
};
el('browser-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('btn-browser-go').click();
});
el('btn-browser-back').onclick = () => { try { webview.goBack(); } catch (e) {} };
el('btn-capture-browser').onclick = captureWebview;

el('btn-add-docs').onclick = async () => {
  const docs = await window.api.pickDocument();
  for (const d of docs) documents.push(d);
  renderDocs();
};
el('btn-clear-docs').onclick = () => { documents = []; renderDocs(); };

function renderDocs() {
  const list = el('doc-list');
  list.innerHTML = '';
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
    rm.onclick = () => { documents.splice(i, 1); renderDocs(); };
    li.appendChild(rm);
    list.appendChild(li);
  });
}

el('btn-solve').onclick = async () => {
  if (!currentImage) return;
  const settings = loadSettings();
  if (!settings.apiKey) {
    setStatus('Add your OpenRouter API key in Settings first.', true);
    settingsDialog.showModal();
    return;
  }
  btnSolve.disabled = true;
  el('results').hidden = true;
  setStatus('Reading the question with the vision model…');
  try {
    const res = await window.api.solveQuestion({
      image: currentImage,
      documents,
      apiKey: settings.apiKey,
      answerModel: settings.answerModel,
      decisionModel: settings.decisionModel
    });
    if (!res.ok) throw new Error(res.error);
    renderResults(res.result);
    setStatus('Done.');
  } catch (err) {
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
  saveSettings({
    apiKey: el('api-key').value.trim(),
    answerModel: el('answer-model').value.trim(),
    decisionModel: el('decision-model').value.trim()
  });
  settingsDialog.close();
};
el('btn-settings-close').onclick = () => settingsDialog.close();
