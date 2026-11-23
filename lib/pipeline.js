const { answerQuestion, scoreAnswers, scoreAnswersViaDecisions, isDecisionsEndpointError } = require('./openrouter');

async function runPipeline({ image, documents, apiKey, answerModel, decisionModel, docDigest }) {
  const answerResult = await answerQuestion({
    apiKey,
    model: answerModel,
    image,
    documents: documents || [],
    docDigest
  });

  const questionText = answerResult && typeof answerResult.question_text === 'string'
    ? answerResult.question_text
    : '';

  let answers;
  let warning = null;
  try {
    const scoredResult = await scoreAnswers({
      apiKey,
      model: decisionModel,
      questionText,
      answerResult,
      documents: documents || []
    });
    answers = extractAnswers(scoredResult) || extractAnswers(answerResult);
  } catch (err) {
    if (isDecisionsEndpointError(err)) {
      const decisionsResult = await scoreAnswersViaDecisions({
        apiKey,
        model: decisionModel,
        questionText,
        answerResult
      });
      answers = extractAnswers(decisionsResult) || extractAnswers(answerResult);
    } else {
      answers = extractAnswers(answerResult);
      warning = 'Decision model failed (' + String(err.message || err).slice(0, 200) +
        '). Showing the answer model\'s results without confidence scores. ' +
        'The decision model can be any chat model (e.g. openai/gpt-4o-mini, ' +
        'perplexity/sonar-reasoning-pro).';
    }
  }

  return { questionText, answerResult, answers, warning };
}

function extractAnswers(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.answers)) return parsed.answers;
  return null;
}

module.exports = { runPipeline };
