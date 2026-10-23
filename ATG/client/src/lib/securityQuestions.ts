/**
 * Account-recovery security questions — must mirror the server-owned list in
 * `server/src/lib/securityQuestions.ts` (ids are what get stored, wording is
 * rendered here for the register/recovery forms).
 */
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
