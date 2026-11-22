const { runOcr } = require('./ocr');
const { answerQuestion, scoreAnswers } = require('./openrouter');

async function runPipeline({ image, documents, apiKey, answerModel, decisionModel, ocrLang }) {
  const ocrText = await runOcr(image, ocrLang);

  const answerResult = await answerQuestion({
    apiKey,
    model: answerModel,
    questionText: ocrText,
    documents: documents || []
  });

  const scoredResult = await scoreAnswers({
    apiKey,
    model: decisionModel,
    questionText: ocrText,
    answerResult,
    documents: documents || []
  });

  const answers = extractAnswers(scoredResult) || extractAnswers(answerResult);
  return { ocrText, answerResult, answers };
}

function extractAnswers(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.answers)) return parsed.answers;
  return null;
}

module.exports = { runPipeline };
