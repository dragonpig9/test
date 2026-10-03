import { useId, useState } from 'react';
import { EMAIL_LOCAL_PART_RE, composeStudentEmail, universityByCode, type StudentDetailsInput, type UniversityCode } from '@commonhours/shared';
import { StudentEmailField } from './StudentEmailField';
import { UniversityPicker } from './UniversityPicker';

export interface StudentDraft {
  university: UniversityCode | null;
  localPart: string;
  declared: boolean;
}

export function useStudentDraft(init?: Partial<StudentDraft>) {
  return useState<StudentDraft>({ university: null, localPart: '', declared: false, ...init });
}

/** The request body, or null while something is missing. The API re-validates the domain anyway. */
export function studentInput(d: StudentDraft): StudentDetailsInput | null {
  if (!d.university || !d.declared || !EMAIL_LOCAL_PART_RE.test(d.localPart)) return null;
  return { university: d.university, studentEmail: composeStudentEmail(d.university, d.localPart), currentStudentDeclaration: true };
}

/** University buttons + username/suffix field + the separate current-student declaration. */
export function StudentDetailsFields({ draft, onChange }: { draft: StudentDraft; onChange: (d: StudentDraft) => void }) {
  const labelId = useId();
  const uni = universityByCode(draft.university);
  return (
    <div className="space-y-4">
      <div>
        <p id={labelId} className="label">
          Your university
        </p>
        {/* Changing the university swaps only the suffix; the typed username is kept. */}
        <UniversityPicker value={draft.university} onChange={(university) => onChange({ ...draft, university })} labelledBy={labelId} />
      </div>
      <StudentEmailField university={draft.university} localPart={draft.localPart} onChange={(localPart) => onChange({ ...draft, localPart })} />
      <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
        <input type="checkbox" className="mt-1" checked={draft.declared} onChange={(e) => onChange({ ...draft, declared: e.target.checked })} />
        <span>
          I declare that I am currently enrolled as a student{uni ? ` at ${uni.name}` : ''}.
          <span className="block text-xs text-slate-500">This is separate from email verification: owning a university email does not by itself prove current enrolment.</span>
        </span>
      </label>
    </div>
  );
}
