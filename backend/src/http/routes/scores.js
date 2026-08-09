import { json } from "../respond.js";
import { readBody } from "../body.js";
import { requireUser } from "../session.js";
import * as scores from "../../services/scores.js";

export async function submit(request, env) {
  const user = await requireUser(request, env);
  const result = await scores.submitScore(
    env,
    await readBody(request, { user }),
  );
  return json(result, 201, request);
}

export async function leaderboard(request, env, { versionId }) {
  return json(await scores.getLeaderboard(env, { versionId }), 200, request);
}

export async function summary(request, env) {
  return json(
    { summary: await scores.getLeaderboardSummary(env) },
    200,
    request,
  );
}
