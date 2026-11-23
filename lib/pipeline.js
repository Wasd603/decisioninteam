const { answerQuestion, answerQuestionText, scoreAnswers, scoreAnswersViaDecisions, isDecisionsEndpointError } = require('./openrouter');

async function runPipeline({ image, manualText, documents, apiKey, answerModel, decisionModel, docDigest, reasoningEffort, secondaryModels }) {
  const t0 = Date.now();
  const tAnswerStart = Date.now();
  let answerResult;
  if (!image && manualText && manualText.trim()) {
    answerResult = await answerQuestionText({
      apiKey,
      model: answerModel,
      questionText: manualText.trim(),
      documents: documents || [],
      docDigest,
      reasoningEffort
    });
  } else {
    if (!image) throw new Error('Nothing to solve: capture an image or type the question.');
    answerResult = await answerQuestion({
      apiKey,
      model: answerModel,
      image,
      documents: documents || [],
      docDigest,
      reasoningEffort
    });
  }
  const answerMs = Date.now() - tAnswerStart;

  const questionText = (answerResult && typeof answerResult.question_text === 'string' && answerResult.question_text.trim())
    ? answerResult.question_text
    : (manualText || '');

  let answers;
  let warning = null;
  const tDecisionStart = Date.now();
  try {
    const scoredResult = await scoreAnswers({
      apiKey,
      model: decisionModel,
      questionText,
      answerResult,
      documents: documents || [],
      reasoningEffort
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
      warning = 'Decision model scored via the Decisions API (probabilities used as confidence).';
    } else {
      answers = extractAnswers(answerResult);
      warning = 'Decision model failed (' + String(err.message || err).slice(0, 200) +
        '). Showing the answer model\'s results without confidence scores. ' +
        'The decision model can be any chat model (e.g. openai/gpt-4o-mini, ' +
        'perplexity/sonar-reasoning-pro).';
    }
  }
  const decisionMs = Date.now() - tDecisionStart;

  const secondary = [];
  let secondaryMs = null;
  const secondaries = (secondaryModels || []).filter(m => m && m.trim());
  if (secondaries.length) {
    const tSecondaryStart = Date.now();
    const secondaryResults = await Promise.all(secondaries.map(async (model) => {
      const entry = { model };
      try {
        const t = Date.now();
        let secAnswer;
        if (!image && manualText && manualText.trim()) {
          secAnswer = await answerQuestionText({ apiKey, model, questionText: manualText.trim(), documents: documents || [], docDigest, reasoningEffort });
        } else {
          secAnswer = await answerQuestion({ apiKey, model, image, documents: documents || [], docDigest, reasoningEffort });
        }
        entry.answerMs = Date.now() - t;
        entry.answerResult = secAnswer;
        try {
          const scored = await scoreAnswers({
            apiKey,
            model: decisionModel,
            questionText,
            answerResult: secAnswer,
            documents: documents || [],
            reasoningEffort
          });
          entry.answers = extractAnswers(scored) || extractAnswers(secAnswer);
        } catch (err) {
          if (isDecisionsEndpointError(err)) {
            const decisionsResult = await scoreAnswersViaDecisions({ apiKey, model: decisionModel, questionText, answerResult: secAnswer });
            entry.answers = extractAnswers(decisionsResult) || extractAnswers(secAnswer);
          } else {
            entry.answers = extractAnswers(secAnswer);
            entry.warning = 'Decision model failed (' + String(err.message || err).slice(0, 160) + ').';
          }
        }
      } catch (err) {
        entry.error = String(err.message || err).slice(0, 300);
      }
      return entry;
    }));
    for (const s of secondaryResults) secondary.push(s);
    secondaryMs = Date.now() - tSecondaryStart;
  }

  return {
    questionText,
    answerResult,
    answers,
    warning,
    secondary,
    timing: { answerMs, decisionMs, secondaryMs, totalMs: Date.now() - t0 }
  };
}

function extractAnswers(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.answers)) return parsed.answers;
  return null;
}

module.exports = { runPipeline };
