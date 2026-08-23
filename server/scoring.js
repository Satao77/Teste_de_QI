import { getQuestionMap, TESTS } from "./catalog.js";

const IQ_MIN = 55;
const IQ_MAX = 145;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function scoreAttempt(answers) {
  const map = getQuestionMap();
  const byTest = new Map(TESTS.map((t) => [t.id, { title: t.title, correct: 0, total: t.questions.length, weight: 0, earned: 0 }]));

  let totalCorrect = 0;
  let totalWeight = 0;
  let earnedWeight = 0;
  let answered = 0;

  for (const [questionId, optionIndex] of Object.entries(answers || {})) {
    const q = map.get(questionId);
    if (!q) continue;
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= q.options.length) {
      continue;
    }

    answered += 1;
    const weight = q.difficulty || 1;
    totalWeight += weight;

    const bucket = byTest.get(q.testId);
    bucket.weight += weight;

    if (optionIndex === q.correct) {
      totalCorrect += 1;
      earnedWeight += weight;
      bucket.correct += 1;
      bucket.earned += weight;
    }
  }

  const totalQ = map.size;
  const unanswered = totalQ - answered;
  const rawPct = totalQ === 0 ? 0 : totalCorrect / totalQ;
  const weightedPct = totalWeight === 0 ? 0 : earnedWeight / [...map.values()].reduce((s, q) => s + (q.difficulty || 1), 0);

  // Escala recreativa: 0% -> 55, 50% -> 100, 100% -> 145 (ponderada por dificuldade)
  const iq = Math.round(clamp(IQ_MIN + weightedPct * (IQ_MAX - IQ_MIN), IQ_MIN, IQ_MAX));

  const breakdown = TESTS.map((t) => {
    const b = byTest.get(t.id);
    return {
      id: t.id,
      title: t.title,
      correct: b.correct,
      total: b.total,
      pct: b.total === 0 ? 0 : b.correct / b.total,
    };
  });

  return {
    iq,
    totalCorrect,
    totalQuestions: totalQ,
    answered,
    unanswered,
    pct: rawPct,
    weightedPct,
    breakdown,
    band: iqBand(iq),
    description: iqDescription(iq),
  };
}

function iqBand(iq) {
  if (iq >= 130) return "Muito superior";
  if (iq >= 120) return "Superior";
  if (iq >= 110) return "Acima da média";
  if (iq >= 90) return "Média";
  if (iq >= 80) return "Abaixo da média";
  return "Limítrofe";
}

function iqDescription(iq) {
  if (iq >= 130) return "Resultado excepcional — desempenho muito acima da média.";
  if (iq >= 115) return "Desempenho superior — acima da média populacional.";
  if (iq >= 100) return "Desempenho na média — resultado equilibrado.";
  if (iq >= 85) return "Desempenho abaixo da média — há margem para melhorar.";
  return "Desempenho modesto — pratique com calma e tente novamente.";
}

function theoreticalPercentile(iq) {
  const z = (iq - 100) / 15;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const cdf = z >= 0 ? 1 - p : p;
  return clamp(Math.round(cdf * 100), 1, 99);
}

export {
  scoreAttempt,
  iqBand,
  iqDescription,
  theoreticalPercentile,
};
