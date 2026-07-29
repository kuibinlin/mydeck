// Deployment constants that are not secrets and not per-request.

// ← UPDATE THESE to your frontend domains before deploying.
// Only these origins are ever reflected in Access-Control-Allow-Origin, and
// only these are accepted as a login redirect target.
export const PROD_ORIGINS = [
  "https://linsnotes.com",
  "https://mydeck.linsnotes.com",
];
