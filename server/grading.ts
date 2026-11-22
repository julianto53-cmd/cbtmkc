export type QuestionType = 'PG' | 'PGK' | 'BS' | 'JODOH' | 'ISIAN' | 'ESAI';

export interface QuestionRecord {
  id: number;
  q_type: QuestionType;
  prompt_text: string;
  options_json: string;
  answer_key_json: string;
  max_score: number;
}

export function gradeQuestionAnswer(
  qType: QuestionType,
  optionsJson: string,
  answerKeyJson: string,
  maxScore: number,
  studentAnswer: unknown
): number {
  if (studentAnswer === null || studentAnswer === undefined || studentAnswer === '') {
    return 0;
  }

  let keyObj: Record<string, any> = {};
  try {
    keyObj = JSON.parse(answerKeyJson || '{}');
  } catch {
    keyObj = {};
  }

  switch (qType) {
    case 'PG': {
      const chosen = typeof studentAnswer === 'string'
        ? studentAnswer.trim().toUpperCase()
        : String((studentAnswer as any)?.choice ?? '').trim().toUpperCase();
      const correct = String(keyObj.correct ?? '').trim().toUpperCase();
      return chosen && chosen === correct ? maxScore : 0;
    }

    case 'PGK': {
      const rawArr = Array.isArray(studentAnswer)
        ? studentAnswer
        : Array.isArray((studentAnswer as any)?.choices)
          ? (studentAnswer as any).choices
          : [];
      const chosenSet = new Set<string>(rawArr.map((x: unknown) => String(x).trim().toUpperCase()).filter(Boolean));
      const correctArr: string[] = Array.isArray(keyObj.correct)
        ? keyObj.correct.map((x: unknown) => String(x).trim().toUpperCase()).filter(Boolean)
        : [];
      const correctSet = new Set<string>(correctArr);
      if (correctSet.size === 0 || chosenSet.size === 0) return 0;

      const partialCredit = keyObj.partialCredit !== false;
      if (!partialCredit) {
        if (chosenSet.size !== correctSet.size) return 0;
        for (const c of correctSet) {
          if (!chosenSet.has(c)) return 0;
        }
        return maxScore;
      }

      let hits = 0;
      let wrongPicks = 0;
      for (const c of chosenSet) {
        if (correctSet.has(c)) hits++;
        else wrongPicks++;
      }
      const ratio = Math.max(0, (hits - wrongPicks * 0.5) / correctSet.size);
      return Number((ratio * maxScore).toFixed(2));
    }

    case 'BS': {
      const correctMap: Record<string, string> = keyObj.correct && typeof keyObj.correct === 'object'
        ? keyObj.correct
        : {};
      const keys = Object.keys(correctMap);
      if (keys.length === 0) {
        // Fallback single B/S
        const singleCorrect = String(keyObj.correct ?? '').trim().toUpperCase();
        const chosen = String(studentAnswer ?? '').trim().toUpperCase();
        return chosen && chosen === singleCorrect ? maxScore : 0;
      }

      const ansMap = typeof studentAnswer === 'object' && studentAnswer !== null
        ? (studentAnswer as Record<string, unknown>)
        : {};
      let correctCount = 0;
      for (const k of keys) {
        const expected = String(correctMap[k] ?? '').trim().toUpperCase();
        const actual = String(ansMap[k] ?? '').trim().toUpperCase();
        if (expected && actual === expected) {
          correctCount++;
        }
      }
      return Number(((correctCount / keys.length) * maxScore).toFixed(2));
    }

    case 'JODOH': {
      const correctPairs: Record<string, string> = keyObj.pairs && typeof keyObj.pairs === 'object'
        ? keyObj.pairs
        : {};
      const leftKeys = Object.keys(correctPairs);
      if (leftKeys.length === 0) return 0;

      const ansPairs = typeof studentAnswer === 'object' && studentAnswer !== null
        ? (studentAnswer as Record<string, unknown>)
        : {};
      let matched = 0;
      for (const lId of leftKeys) {
        const expectedRight = String(correctPairs[lId] ?? '').trim();
        const actualRight = String(ansPairs[lId] ?? '').trim();
        if (expectedRight && actualRight === expectedRight) {
          matched++;
        }
      }
      return Number(((matched / leftKeys.length) * maxScore).toFixed(2));
    }

    case 'ISIAN': {
      const rawText = typeof studentAnswer === 'string'
        ? studentAnswer
        : String((studentAnswer as any)?.text ?? '');
      let opts: Record<string, any> = {};
      try {
        opts = JSON.parse(optionsJson || '{}');
      } catch {
        opts = {};
      }
      const caseSensitive = Boolean(opts.caseSensitive);
      const normalize = (s: string) => {
        const trimmed = s.trim().replace(/\s+/g, ' ');
        return caseSensitive ? trimmed : trimmed.toLowerCase();
      };
      const normalizedAns = normalize(rawText);
      if (!normalizedAns) return 0;
      const accepted: string[] = Array.isArray(keyObj.accepted)
        ? keyObj.accepted.map((x: unknown) => normalize(String(x)))
        : typeof keyObj.correct === 'string'
          ? keyObj.correct.split('|').map((x: string) => normalize(x))
          : [];
      return accepted.includes(normalizedAns) ? maxScore : 0;
    }

    case 'ESAI': {
      // Essay requires manual grading; optional reference keywords do not finalize until teacher checks
      return 0;
    }

    default:
      return 0;
  }
}
