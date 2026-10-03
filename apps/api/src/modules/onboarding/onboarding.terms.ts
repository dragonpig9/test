/**
 * Community terms shown on both registration routes. The invitation route adds the vouch terms
 * (modules/invitations); the student route has no inviter, so no vouch and no liability.
 */
export const SHARED_COMMUNITY_TERMS = [
  'Every hour of service is worth one time credit, whatever the service. Credits cannot be bought, sold or converted to cash.',
  'Before work starts, both members agree the terms: who provides what, duration, time, punctuality, credits, gift bonus, cancellation and confirmation deadline.',
  'Disagreements are judged only against the terms agreed before the service, by randomly selected community attestors.',
  'You may leave at any time; open obligations, disputes and history remain.',
] as const;

export const STUDENT_TERMS = [
  'You join as a student of a Hong Kong university. Nobody vouches for you yet: you start like any new member, with no credits and no credibility, and build trust by helping.',
  'Your university circle is for conversation and discovery. Joining it never creates friendships, vouches, credibility or relationship strength.',
  ...SHARED_COMMUNITY_TERMS,
] as const;
