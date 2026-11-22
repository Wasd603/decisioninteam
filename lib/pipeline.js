const { answerQuestion, scoreAnswers } = require('./openrouter');

async function runPipeline({ image, documents, apiKey, answerModel, decisionModel }) {
  const answerResult = await answerQuestion({
    apiKey,
    model: answerModel,
    image,
    documents: documents || []
  });

  const scoredResult = await scoreAnswers({
    apiKey,
    model: decisionModel,
    image,
    answerResult,
    documents: documents || []
  });

  const answers = extractAnswers(scoredResult) || extractAnswers(answerResult);
  const questionText = answerResult && typeof answerResult.question_text === 'string'
    ? answerResult.question_text
    : '';
  return { questionText, answerResult, answers };
}

function extractAnswers(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.answers)) return parsed.answers;
  return null;
}

module.exports = { runPipeline };
