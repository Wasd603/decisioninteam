const DEFAULT_ANSWER_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_DECISION_MODEL = 'openai/gpt-4o-mini';

async function callOpenRouter({ apiKey, model, messages, maxTokens = 2000, jsonMode = true, reasoningEffort = null }) {
  if (!apiKey) throw new Error('Missing OpenRouter API key. Add one in Settings.');
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'Quiz Solver'
  };

  const body = {
    model,
    messages,
    provider: { sort: 'throughput' }
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (jsonMode) body.response_format = { type: 'json_object' };
  if (reasoningEffort && reasoningEffort !== 'default') {
    body.reasoning = { effort: reasoningEffort };
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter request failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (content) return content;
  const reason = choice && choice.finish_reason ? ' (finish_reason: ' + choice.finish_reason + ')' : '';
  throw new Error('EMPTY_RESPONSE' + reason);
}

const EMPTY_RE = /^EMPTY_RESPONSE/;
const RATE_LIMIT_RE = /\(429\)/;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callOpenRouterWithRetry(args) {
  try {
    return await callOpenRouter(args);
  } catch (err) {
    if (RATE_LIMIT_RE.test(String(err.message))) {
      await sleep(6000);
      return await callOpenRouter(args);
    }
    if (EMPTY_RE.test(String(err.message))) {
      const retry = Object.assign({}, args);
      if (String(err.message).includes('length') && !retry.reasoningEffort) {
        retry.reasoningEffort = 'low';
      }
      return await callOpenRouter(retry);
    }
    throw err;
  }
}

function friendlyEmptyError(err) {
  if (!EMPTY_RE.test(String(err.message))) return err;
  const e = new Error(
    'The model returned an empty response' +
    (String(err.message).includes('length') ? ' — it ran out of output tokens (likely a reasoning model).' : ' (provider hiccup).') +
    ' Try re-running, or switch the model (chat models like openai/gpt-4o-mini are safe).'
  );
  return e;
}


function docContextFor(docDigest, documents) {
  let ctx = '';
  if (docDigest) {
    ctx += '\n\nPRE-DIGESTED OVERVIEW OF REFERENCE DOCUMENTS (for orientation only; the full verbatim texts follow):\n' + docDigest;
  }
  if (documents && documents.length) {
    ctx += '\n\nREFERENCE DOCUMENTS (FULL VERBATIM TEXT — use these as the source of truth):\n' +
      documents.map(d => `--- ${d.name} ---\n${d.text}`).join('\n\n');
  }
  return ctx;
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim());
  } catch (err) {
    return null;
  }
}

function parseJson(raw) {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`Model did not return valid JSON: ${trimmed.slice(0, 300)}`);
  }
}

function imagePart(imageDataUrl) {
  return { type: 'image_url', image_url: { url: imageDataUrl } };
}

async function answerQuestionText({ apiKey, model, questionText, documents, docDigest, reasoningEffort }) {
  const docContext = docContextFor(docDigest, documents);

  const messages = [
    {
      role: 'system',
      content:
        'Answer the multiple-choice question. Respond ONLY with JSON: ' +
        '{"question_text":"the question plus every choice, verbatim","answers":[{"choice":"A","correct":true,"explanation":"max 10 words"}]}. ' +
        'One entry per choice (up to 5, A-E); exactly the correct ones are marked, and at least one is correct. ' +
        'Use the reference documents if provided.'
    },
    {
      role: 'user',
      content: questionText + docContext
    }
  ];

  const raw = await callOpenRouterWithRetry({ apiKey, model: model || DEFAULT_ANSWER_MODEL, messages, maxTokens: null, reasoningEffort });
  return parseJson(raw);
}

async function answerQuestion({ apiKey, model, image, documents, docDigest, reasoningEffort }) {
  const docContext = docContextFor(docDigest, documents);

  const messages = [
    {
      role: 'system',
      content:
        'Read the multiple-choice question in the screenshot and answer it. Respond ONLY with JSON: ' +
        '{"question_text":"question plus every choice, verbatim","answers":[{"choice":"A","correct":true,"explanation":"max 10 words"}]}. ' +
        'One entry per visible choice (there may be up to 5, A-E); exactly the correct ones are marked, and at least one is correct. Use the reference documents if provided. ' +
        'Reply in the question\'s language (it may be Romanian, Hungarian, or English).'
    },
    {
      role: 'user',
      content: [
        imagePart(image),
        { type: 'text', text: 'Read the multiple-choice question in this screenshot and answer it.' + docContext }
      ]
    }
  ];

  const raw = await callOpenRouterWithRetry({ apiKey, model: model || DEFAULT_ANSWER_MODEL, messages, maxTokens: null, reasoningEffort });
  return parseJson(raw);
}

async function scoreAnswers({ apiKey, model, questionText, answerResult, documents, reasoningEffort }) {
  const messages = [
    {
      role: 'system',
      content:
        'Verify the proposed answers to the question. Respond ONLY with JSON: ' +
        '{"answers":[{"choice":"A","correct":true,"confidence":0.87,"explanation":"max 10 words"}]}. ' +
        'Confidence is 0-1. One entry per choice. You may disagree.'
    },
    {
      role: 'user',
      content:
        'Question with its choices:\n' + questionText + '\n\n' +
        'Proposed answers from the answer model:\n' + JSON.stringify(answerResult, null, 2)
    }
  ];

  const raw = await callOpenRouterWithRetry({ apiKey, model: model || DEFAULT_DECISION_MODEL, messages, maxTokens: null, reasoningEffort });
  return parseJson(raw);
}


const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

function isDecisionsEndpointError(err) {
  return /decisions endpoint/i.test(String(err && err.message ? err.message : err)) ||
         /decisions model/i.test(String(err && err.message ? err.message : err));
}

async function callDecisionsApi({ apiKey, model, state, questions }) {
  if (!apiKey) throw new Error('Missing OpenRouter API key. Add one in Settings.');
  const res = await fetch(DECISIONS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, state, questions })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter decisions request failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  return res.json();
}


async function analyzeDocuments({ apiKey, model, documents, reasoningEffort }) {
  const docText = documents.map(d => `--- ${d.name} ---\n${d.text}`).join('\n\n');
  const messages = [
    {
      role: 'user',
      content:
        'Prepare a study digest of the documents below — a compact but complete cheat-sheet (max ~1500 words) ' +
        'covering definitions, categories, deadlines (days/months/years), responsible roles, condition lists, ' +
        'and article references, written so another model can answer exam questions from it. ' +
        'Preserve exact numbers and names. Reply with the digest text only (no JSON, no preamble), ' +
        'in the documents\' language.\n\n' + docText
    }
  ];
  let raw;
  try {
    raw = await callOpenRouterWithRetry({ apiKey, model: model || DEFAULT_ANSWER_MODEL, messages, maxTokens: null, jsonMode: false, reasoningEffort });
  } catch (err) {
    throw friendlyEmptyError(err);
  }
  raw = raw.trim().replace(/^```(?:\w+)?\n?/i, '').replace(/\n?```$/i, '').trim();
  const asJson = tryParseJson(raw);
  if (asJson && typeof asJson.digest === 'string' && asJson.digest.trim()) return asJson.digest;
  if (!raw) throw new Error('Analysis returned an empty digest.');
  return raw;
}


async function ocrImageViaMistral({ apiKey, model, imageDataUrl }) {
  const { buildPdfFromJpeg, jpegSize } = require('./pdfwrap');
  const b64 = imageDataUrl.split(',')[1];
  const jpegBuf = Buffer.from(b64, 'base64');
  const { width, height } = jpegSize(jpegBuf);
  const pdf = buildPdfFromJpeg(jpegBuf, width, height);
  const pdfDataUrl = 'data:application/pdf;base64,' + pdf.toString('base64');

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Print the full text of the attached document verbatim. Output nothing else.' },
        { type: 'file', file: { filename: 'capture.pdf', file_data: pdfDataUrl } }
      ]
    }
  ];

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Quiz Solver'
    },
    body: JSON.stringify({
      model: model || DEFAULT_ANSWER_MODEL,
      messages,
      max_tokens: 4000,
      plugins: [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }]
    })
  });

  let data = null;
  try { data = await res.json(); } catch (e) { /* fall through */ }

  const extractAnnotationText = (d) => {
    const anns = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.annotations;
    if (!Array.isArray(anns)) return null;
    const texts = [];
    for (const a of anns) {
      if (a && a.file && Array.isArray(a.file.content)) {
        for (const part of a.file.content) {
          if (part && part.type === 'text' && part.text) texts.push(part.text);
        }
      }
    }
    return texts.length ? texts.join('\n') : null;
  };

  const ocrText = extractAnnotationText(data)
    || (data && data.error && data.error.metadata && extractAnnotationText({ choices: [{ message: { annotations: data.error.metadata.file_annotations } }] }));

  if (ocrText && ocrText.trim()) return ocrText.trim();

  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (content && content.trim()) return content.trim();

  const detail = data && data.error ? JSON.stringify(data.error).slice(0, 400) : '(no annotations, no content)';
  throw new Error('Mistral OCR returned no text: ' + detail);
}

function extractAnswers(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.answers)) return parsed.answers;
  return null;
}

async function callDecisionsApiWithRateLimitRetry(args) {
  try {
    return await callDecisionsApi(args);
  } catch (err) {
    if (RATE_LIMIT_RE.test(String(err.message))) {
      await sleep(6000);
      return await callDecisionsApi(args);
    }
    throw err;
  }
}

async function scoreAnswersViaDecisions({ apiKey, model, questionText, answerResult }) {
  const proposed = extractAnswers(answerResult) || [];
  const state = {
    question: questionText,
    proposed_answers: proposed
  };

  const questions = {};
  for (const a of proposed) {
    questions['correct_' + a.choice] = {
      type: 'noul',
      instructions:
        'The question above may have multiple correct choices (up to one fewer than the number of choices). Is "' + a.choice + '" a correct answer ' +
        'to the question, judged on its own merits (not based on the proposed answers)?',
      criteria: {
        true: 'This choice is a correct answer to the question.',
        false: 'This choice is not a correct answer to the question.'
      }
    };
  }

  const data = await callDecisionsApiWithRateLimitRetry({ apiKey, model, state, questions });
  const answers = [];
  for (const a of proposed) {
    const ans = data.answers && data.answers['correct_' + a.choice];
    const prob = ans && typeof ans.noul === 'number' ? ans.noul : null;
    answers.push({
      choice: a.choice,
      correct: prob !== null ? prob >= 0.5 : a.correct,
      confidence: prob !== null ? prob : (a.correct ? 1 : 0),
      explanation: a.explanation || 'Decision model probability: ' + prob
    });
  }
  return { answers };
}

module.exports = { answerQuestion, answerQuestionText, scoreAnswers, scoreAnswersViaDecisions, analyzeDocuments, ocrImageViaMistral, isDecisionsEndpointError };
