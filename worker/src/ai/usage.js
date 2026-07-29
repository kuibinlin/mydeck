// AI usage accounting and rate limiting.
//
// Backed by D1 rather than KV because the question is "how many calls today",
// which is a SQL COUNT with a date filter.
//
// NOTE: ai_usage_log.user_id is TEXT while users.id is INTEGER. Binding an
// integer against a TEXT column silently matches nothing in SQLite, so every
// bind here goes through String().

export async function checkRateLimit(user, env) {
  const userId = String(user.id);

  const usageQuery = () =>
    env.DB.prepare(
      "SELECT COUNT(*) as count FROM ai_usage_log WHERE user_id = ? AND created_at >= date('now')",
    )
      .bind(userId)
      .first();

  // Admins bypass limits so they can test and moderate freely.
  if (env.ADMIN_EMAILS) {
    const adminEmails = env.ADMIN_EMAILS.split(",").map((e) => e.trim());
    if (adminEmails.includes(user.email)) {
      const row = await usageQuery();
      return { limited: false, used: row.count, limit: null };
    }
  }

  const plan = "free"; // Look up the user's tier once paid plans exist.
  const raw = plan === "pro" ? env.AI_DAILY_LIMIT_PRO : env.AI_DAILY_LIMIT_FREE;

  // Unset or empty means no limit.
  if (!raw || raw.trim() === "") {
    const row = await usageQuery();
    return { limited: false, used: row.count, limit: null };
  }

  const limit = parseInt(raw, 10);
  const row = await usageQuery();
  const used = row.count;
  return { limited: used >= limit, used, limit };
}

export async function logUsage(user, endpoint, env) {
  await env.DB.prepare(
    "INSERT INTO ai_usage_log (user_id, endpoint, plan) VALUES (?, ?, ?)",
  )
    .bind(String(user.id), endpoint, "free")
    .run();
}
