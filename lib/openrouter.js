const DEFAULT_ANSWER_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_DECISION_MODEL = 'openai/gpt-4o-mini';

async function callOpenRouter({ apiKey, model, messages, maxTokens = 2000, jsonMode = true }) {
  if (!apiKey) throw new Error('Missing OpenRouter API key. Add one in Settings.');
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'Quiz Solver'
  };

  const body = {
    model,
    messages,
    max_tokens: maxTokens
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

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
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('OpenRouter returned an empty response.');
  return content;
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

async function answerQuestion({ apiKey, model, image, documents }) {
  const docContext = documents && documents.length
    ? '\n\nREFERENCE DOCUMENTS:\n' + documents.map(d => `--- ${d.name} ---\n${d.text.slice(0, 24000)}`).join('\n\n')
    : '';

  const messages = [
    {
      role: 'system',
      content:
        'You answer multiple-choice questions shown in a screenshot. The screenshot may be in Romanian, ' +
        'Hungarian, or English. Respond ONLY with a JSON object: ' +
        '{"question_text":"<the full text of the question AND every answer choice, exactly as shown in the image>","answers":[{"choice":"A","correct":true,"explanation":"..."}]}. ' +
        'Include an entry for every visible choice (A-D, or however many exist). ' +
        'Between 1 and 4 answers may be correct; mark exactly the ones that are correct. ' +
        'If reference documents are provided, base your answer on them. ' +
        'Write question_text and explanations in the language of the question.'
    },
    {
      role: 'user',
      content: [
        imagePart(image),
        { type: 'text', text: 'Read the multiple-choice question in this screenshot and answer it.' + docContext }
      ]
    }
  ];

  const raw = await callOpenRouter({ apiKey, model: model || DEFAULT_ANSWER_MODEL, messages, maxTokens: 3000 });
  return parseJson(raw);
}

async function scoreAnswers({ apiKey, model, questionText, answerResult, documents }) {
  const messages = [
    {
      role: 'system',
      content:
        'You are a verification and confidence-scoring model. You receive the text of a multiple-choice ' +
        'question (it may be in Romanian, Hungarian, or English) and another model\'s proposed answers. ' +
        'Independently judge each choice, then respond ONLY with JSON: ' +
        '{"answers":[{"choice":"A","correct":true,"confidence":0.87,"explanation":"..."}]}. ' +
        'Confidence is a number between 0 and 1. Include an entry for every choice. ' +
        'You may disagree with the proposed answers.'
    },
    {
      role: 'user',
      content:
        'Question with its choices:\n' + questionText + '\n\n' +
        'Proposed answers from the answer model:\n' + JSON.stringify(answerResult, null, 2)
    }
  ];

  const raw = await callOpenRouter({ apiKey, model: model || DEFAULT_DECISION_MODEL, messages, maxTokens: 3000 });
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

function extractAnswers(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.answers)) return parsed.answers;
  return null;
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
        'The question above may have 1 to 4 correct choices. Is "' + a.choice + '" a correct answer ' +
        'to the question, judged on its own merits (not based on the proposed answers)?',
      criteria: {
        true: 'This choice is a correct answer to the question.',
        false: 'This choice is not a correct answer to the question.'
      }
    };
  }

  const data = await callDecisionsApi({ apiKey, model, state, questions });
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

module.exports = { answerQuestion, scoreAnswers, scoreAnswersViaDecisions, isDecisionsEndpointError };
