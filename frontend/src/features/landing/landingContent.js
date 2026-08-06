// All landing page copy lives here.
// To update text, edit this file only — no need to touch components.

export const HERO = {
  headlineLine1: 'Built by Learners,',
  headlineLine2: 'for Learners.',
  subheadline: 'Every deck you create helps someone else learn.',
  aiPill: 'AI Generator for Flashcards & Quizzes',
  ctaPrimary: { label: 'Get Started Free', to: '/login' },
  ctaSecondary: { label: 'Sign In', to: '/login' },
}

export const FEATURES = [
  {
    icon: 'fas fa-clone',
    title: 'Flashcard Decks',
    description: 'Build decks on any topic you care about. Study at your own pace, flip through cards, and actually remember what you learn.',
    color: 'var(--primary)',
  },
  {
    icon: 'fas fa-bolt',
    title: 'Challenges',
    description: 'Turn your knowledge into a quiz. Publish a challenge, share it with friends, and see who really knows their stuff.',
    color: 'var(--warning)',
  },
  {
    icon: 'fas fa-trophy',
    title: 'Leaderboard',
    description: 'Every challenge has a live leaderboard. Compete, compare scores, and climb to the top — on your own terms.',
    color: 'var(--success)',
  },
]

export const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Create Your Deck',
    description: 'Add flashcards or quiz questions on any topic — your syllabus, your hobby, your curiosity.',
  },
  {
    step: '02',
    title: 'Study or Challenge',
    description: 'Flip through flashcards solo, or publish a challenge for others to attempt.',
  },
  {
    step: '03',
    title: 'Compete & Rank',
    description: 'Submit your score, watch the leaderboard update live, and prove you know your stuff.',
  },
]

export const CTA = {
  headline: 'Ready to Own Your Learning?',
  subheadline: 'No syllabus. No teacher. Just you and what you want to know.',
  button: { label: 'Start for Free', to: '/login' },
}

export const NAV = {
  logo: 'MyDeck',
  links: [
    { label: 'Features', href: '#features' },
    { label: 'How it works', href: '#how-it-works' },
  ],
  signIn: { label: 'Sign In', to: '/login' },
}
