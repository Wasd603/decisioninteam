const { answerQuestion, answerQuestionText, scoreAnswers, scoreAnswersViaDecisions, analyzeDocuments, ocrImageViaMistral, isDecisionsEndpointError } = require('./openrouter');

async function runPipeline({ image, manualText, documents, apiKey, answerModel, decisionModel, docDigest, reasoningEffort, secondaryModels, ocrStage }) {
  const t0 = Date.now();
  let ocrText = null;
  let ocrMs = null;
  let ocrFallBackError = null;
  let image2 = image;
  let text2 = manualText || '';

  if (image && (!manualText || !manualText.trim()) && ocrStage !== 'off') {
    const tOcr = Date.now();
    try {
      ocrText = await ocrImageViaMistral({ apiKey, model: answerModel, imageDataUrl: image });
      ocrMs = Date.now() - tOcr;
      text2 = ocrText;
      image2 = null;
    } catch (err) {
      ocrMs = Date.now() - tOcr;
      // fall back to the vision path; the caller sees the warning string
      ocrText = null;
      text2 = manualText || '';
      image2 = image;
      ocrFallBackError = String(err.message || err).slice(0, 200);
    }
  }

  const tAnswerStart = Date.now();
  let answerResult;
  if (!image2 && text2 && text2.trim()) {
    answerResult = await answerQuestionText({
      apiKey,
      model: answerModel,
      questionText: text2.trim(),
      documents: documents || [],
      docDigest,
      reasoningEffort
    });
  } else {
    if (!image2) throw new Error('Nothing to solve: capture an image or type the question.');
    answerResult = await answerQuestion({
      apiKey,
      model: answerModel,
      image: image2,
      documents: documents || [],
      docDigest,
      reasoningEffort
    });
  }
  const answerMs = Date.now() - tAnswerStart;

  const questionText = (answerResult && typeof answerResult.question_text === 'string' && answerResult.question_text.trim())
    ? answerResult.question_text
    : (ocrText || text2 || '');

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
        if (!image2 && text2 && text2.trim()) {
          secAnswer = await answerQuestionText({ apiKey, model, questionText: text2.trim(), documents: documents || [], docDigest, reasoningEffort });
        } else {
          secAnswer = await answerQuestion({ apiKey, model, image: image2, documents: documents || [], docDigest, reasoningEffort });
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

  if (ocrFallBackError) {
    warning = (warning ? warning + ' ' : '') + 'OCR stage failed (' + ocrFallBackError + '); answered via the vision path instead.';
  }

  return {
    questionText,
    ocrText,
    answerResult,
    answers,
    warning,
    secondary,
    timing: { ocrMs, answerMs, decisionMs, secondaryMs, totalMs: Date.now() - t0 }
  };
}

function extractAnswers(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.answers)) return parsed.answers;
  return null;
}

module.exports = { runPipeline };
