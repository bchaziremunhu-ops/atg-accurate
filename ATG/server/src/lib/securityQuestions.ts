
export interface SecurityQuestion {
  id: string;
  text: string;
}

export const SECURITY_QUESTIONS: SecurityQuestion[] = [
  { id: 'city_birth', text: 'What city were you born in?' },
  { id: 'first_school', text: 'What is the name of your first school?' },
  { id: 'mother_maiden', text: "What is your mother's maiden name?" },
  { id: 'first_pet', text: 'What was the name of your first pet?' },
  { id: 'street_first', text: 'What street did you grow up on?' },
  { id: 'first_job', text: 'What was the name of your first employer?' },
  { id: 'nickname', text: 'What was your childhood nickname?' },
  { id: 'favorite_teacher', text: 'Who was your favourite teacher?' },
];

const BY_ID = new Map(SECURITY_QUESTIONS.map((q) => [q.id, q]));

export function questionById(id: string): SecurityQuestion | undefined {
  return BY_ID.get(id);
}

export function isValidQuestionId(id: string): boolean {
  return BY_ID.has(id);
}
