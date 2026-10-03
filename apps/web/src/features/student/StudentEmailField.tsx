import { useId, useState } from 'react';
import { EMAIL_LOCAL_PART_RE, emailSuffixFor, sanitizeEmailLocalPart, type UniversityCode } from '@commonhours/shared';

/**
 * Username input with the selected university's domain as a FIXED suffix:
 *   [ username ] @connect.hku.hk
 * Typing or pasting "@" (or a whole address) keeps only the part before "@", so the domain can never
 * be duplicated. The suffix follows the selected university; the typed username is kept when it changes.
 */
export function StudentEmailField({ university, localPart, onChange }: { university: UniversityCode | null; localPart: string; onChange: (v: string) => void }) {
  const id = useId();
  const [stripped, setStripped] = useState(false);
  const suffix = university ? emailSuffixFor(university) : '@…';
  const invalid = localPart !== '' && !EMAIL_LOCAL_PART_RE.test(localPart);
  return (
    <div>
      <label className="label" htmlFor={id}>
        University email
      </label>
      <div className="flex w-full items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/30">
        <input
          id={id}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
          placeholder="XXX"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
          value={localPart}
          disabled={!university}
          aria-describedby={`${id}-preview ${id}-hint`}
          aria-invalid={invalid}
          onChange={(e) => {
            const raw = e.target.value;
            setStripped(raw.includes('@'));
            onChange(sanitizeEmailLocalPart(raw));
          }}
        />
        <span className="flex items-center whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 text-sm text-slate-600" aria-hidden>
          {suffix}
        </span>
      </div>
      <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
        {!university
          ? 'Choose your university first.'
          : stripped
            ? `Only the part before “@” is needed — ${suffix} is added for you.`
            : `Enter only your username; ${suffix} is fixed by your university.`}
      </p>
      {invalid && <p className="mt-1 text-xs text-red-700">Use letters, digits and . _ + - only (no spaces, no leading/trailing or double dots).</p>}
      <p id={`${id}-preview`} className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm" aria-live="polite">
        <span className="text-slate-500">Full address: </span>
        <span className="num font-medium text-slate-900">
          {localPart || 'XXX'}
          {suffix}
        </span>
      </p>
    </div>
  );
}
