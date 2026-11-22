const { answerQuestion, scoreAnswers } = require('./openrouter');

async function runPipeline({ image, documents, apiKey, answerModel, decisionModel }) {
  const answerResult = await answerQuestion({
    apiKey,
    model: answerModel,
    image,
    documents: documents || []
  });

  let answers;
  let warning = null;
  try {
    const scoredResult = await scoreAnswers({
      apiKey,
      model: decisionModel,
      image,
      answerResult,
      documents: documents || []
    });
    answers = extractAnswers(scoredResult) || extractAnswers(answerResult);
  } catch (err) {
    answers = extractAnswers(answerResult);
    warning = 'Decision model failed (' + String(err.message || err).slice(0, 200) +
      '). Showing the answer model\'s results without confidence scores. ' +
      'Note: the decision model must be a vision-capable chat model ' +
      '(e.g. openai/gpt-4o-mini, google/gemini-2.0-flash-001).';
  }

  const questionText = answerResult && typeof answerResult.question_text === 'string'
    ? answerResult.question_text
    : '';
  return { questionText, answerResult, answers, warning };
}

function extractAnswers(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.answers)) return parsed.answers;
  return null;
}

module.exports = { runPipeline };
