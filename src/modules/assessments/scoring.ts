import type { QuestionType, ResponsePayload } from "../../db/index.js";

/** Option keys follow `sequence_order`: 0 → A, 1 → B, … */
export const optionKey = (sequenceOrder: number) => String.fromCharCode(65 + sequenceOrder);

export type ScorableQuestion = {
  type: QuestionType;
  options: { sequenceOrder: number; isCorrect: boolean; optionText: string }[];
};

export type Marks = { correct: number; incorrect: number; unattempted: number };

export type Evaluation = {
  attempted: boolean;
  /** `null` when unattempted or awaiting manual grading (subjective). */
  isCorrect: boolean | null;
  /** `null` while a subjective answer awaits grading. */
  marks: number | null;
};

export function isAnswered(type: QuestionType, payload: ResponsePayload | null | undefined): boolean {
  if (!payload) return false;
  if (type === "integer") return typeof payload.value === "number" && Number.isFinite(payload.value);
  if (type === "subjective") return Boolean(payload.text?.trim());
  return Boolean(payload.selected?.length);
}

const INTEGER_TOLERANCE = 1e-6;

export function evaluateResponse(
  question: ScorableQuestion,
  marks: Marks,
  payload: ResponsePayload | null | undefined,
): Evaluation {
  if (!isAnswered(question.type, payload)) {
    return { attempted: false, isCorrect: null, marks: marks.unattempted };
  }
  if (question.type === "subjective") return { attempted: true, isCorrect: null, marks: null };

  let correct: boolean;
  if (question.type === "integer") {
    const answer = Number(question.options.find((o) => o.isCorrect)?.optionText);
    correct = Math.abs((payload!.value as number) - answer) < INTEGER_TOLERANCE;
  } else {
    const expected = new Set(question.options.filter((o) => o.isCorrect).map((o) => optionKey(o.sequenceOrder)));
    const selected = new Set(payload!.selected!.map((s) => s.toUpperCase()));
    correct = expected.size === selected.size && [...expected].every((k) => selected.has(k));
  }
  return { attempted: true, isCorrect: correct, marks: correct ? marks.correct : marks.incorrect };
}

/** Converts the frontend's `answers: Record<questionId, string[]>` entry into a stored payload. */
export function payloadFromAnswer(type: QuestionType, answer: string[]): ResponsePayload | null {
  if (!answer.length) return null;
  if (type === "integer") {
    const value = Number(answer[0]);
    return Number.isFinite(value) ? { value } : null;
  }
  if (type === "subjective") return { text: answer.join("\n") };
  return { selected: answer.map((a) => a.trim().toUpperCase()).filter((a) => /^[A-Z]$/.test(a)) };
}
