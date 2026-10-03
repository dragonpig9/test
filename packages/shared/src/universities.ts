/**
 * University ↔ student email domain mapping. This is the ONLY place the mapping is defined:
 * the web registration buttons, the email suffix and the API validation all read it from here.
 * To add or change a university, edit this list (and nothing else).
 */
export const UNIVERSITIES = [
  { code: 'HKU', name: 'The University of Hong Kong', domain: 'connect.hku.hk' },
  { code: 'CUHK', name: 'The Chinese University of Hong Kong', domain: 'link.cuhk.edu.hk' },
  { code: 'HKUST', name: 'The Hong Kong University of Science and Technology', domain: 'connect.ust.hk' },
  { code: 'PolyU', name: 'The Hong Kong Polytechnic University', domain: 'connect.polyu.hk' },
  { code: 'CityU', name: 'City University of Hong Kong', domain: 'my.cityu.edu.hk' },
  { code: 'HKBU', name: 'Hong Kong Baptist University', domain: 'life.hkbu.edu.hk' },
  { code: 'Lingnan', name: 'Lingnan University', domain: 'ln.hk' },
  { code: 'EdUHK', name: 'The Education University of Hong Kong', domain: 's.eduhk.hk' },
] as const;

export type University = (typeof UNIVERSITIES)[number];
export type UniversityCode = University['code'];
export const UNIVERSITY_CODES = UNIVERSITIES.map((u) => u.code) as [UniversityCode, ...UniversityCode[]];

export function universityByCode(code: string | null | undefined): University | undefined {
  return UNIVERSITIES.find((u) => u.code === code);
}

/** "@connect.hku.hk" for HKU. */
export function emailSuffixFor(code: UniversityCode): string {
  return `@${universityByCode(code)!.domain}`;
}

/**
 * Allowed username (local part): letters, digits and . _ + - ; 1–64 characters; no leading,
 * trailing or doubled dots. No "@" and no domain — the domain always comes from the university.
 */
export const EMAIL_LOCAL_PART_RE = /^(?!\.)(?!.*\.\.)[A-Za-z0-9._+-]{1,64}(?<!\.)$/;

/**
 * Cleans what the user typed/pasted into the username box: anything from the first "@" onwards
 * is dropped (so "abc@connect.hku.hk" becomes "abc", never "abc@connect.hku.hk@connect.hku.hk"),
 * and surrounding whitespace is removed.
 */
export function sanitizeEmailLocalPart(raw: string): string {
  return raw.split('@')[0].trim();
}

export function composeStudentEmail(code: UniversityCode, localPart: string): string {
  return `${sanitizeEmailLocalPart(localPart).toLowerCase()}${emailSuffixFor(code)}`;
}

/**
 * Checks that `email` is exactly <valid username>@<the selected university's domain>.
 * Returns null when valid, otherwise a human-readable reason. Used by zod (client + server)
 * and again inside the student service.
 */
export function studentEmailProblem(code: string, email: string): string | null {
  const uni = universityByCode(code);
  if (!uni) return `Unknown university “${code}”. Choose one of: ${UNIVERSITY_CODES.join(', ')}.`;
  const at = email.lastIndexOf('@');
  if (at <= 0) return 'Enter your university email username.';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (local.includes('@')) return 'The username must not contain “@”.';
  if (domain !== uni.domain) return `${uni.code} student emails must end in @${uni.domain} (got @${domain}).`;
  if (!EMAIL_LOCAL_PART_RE.test(local)) return 'The username may use letters, digits and . _ + - (no spaces, no leading/trailing or double dots).';
  return null;
}
