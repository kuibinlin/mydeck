// Transactional email via Resend.
//
// Isolated here so swapping providers touches one file, and so services/auth.js
// does not need to know what an HTTP email API looks like.

import { AppError } from "../services/errors.js";

const ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendLoginEmail(env, { to, displayName, loginUrl }) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to,
      subject: "Your Linsnotes login link",
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px;">
          <h2>Hi ${escapeHtml(displayName)}!</h2>
          <p>Click the button below to log in:</p>
          <a href="${loginUrl}"
             style="display:inline-block;padding:12px 24px;background:#0071e3;color:#fff;
                    text-decoration:none;border-radius:8px;font-weight:600;">
            Log in to MyDeck
          </a>
          <p style="color:#888;font-size:13px;margin-top:20px;">
            This link expires in 15 minutes. If you didn't request this, ignore this email.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    throw new AppError(500, "Failed to send email");
  }
}
