import { z } from 'zod';
import { UNIVERSITY_CODES, studentEmailProblem } from '../universities';

/**
 * Student details as sent by the registration form and the profile form.
 * The client sends the full address it composed from <username> + the university's suffix;
 * the server re-checks the address against the university's domain (never trusts the client).
 */
export const studentDetailsSchema = z
  .object({
    university: z.enum(UNIVERSITY_CODES),
    studentEmail: z.string().trim().toLowerCase().max(200),
    /** Separate from email verification: owning a university mailbox does not prove current enrolment. */
    currentStudentDeclaration: z.literal(true, { errorMap: () => ({ message: 'Confirm that you are currently enrolled at this university' }) }),
  })
  .superRefine((v, ctx) => {
    const problem = studentEmailProblem(v.university, v.studentEmail);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['studentEmail'], message: problem });
  });

export type StudentDetailsInput = z.infer<typeof studentDetailsSchema>;
