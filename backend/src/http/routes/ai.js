// AI routes are thin on purpose: validation, quota, prompting and usage
// logging all live in services/aiContent.js, so a test can perform the same
// generation without going through HTTP. An agent tool used to be the other
// caller; `tools/` went in §11 step 9 and the split is worth keeping anyway.

import { json } from "../respond.js";
import { readBody } from "../body.js";
import { requireUser } from "../session.js";
import * as aiContent from "../../services/aiContent.js";

export async function usage(request, env) {
  const user = await requireUser(request, env);
  return json({ usage: await aiContent.getUsage(env, { user }) }, 200, request);
}

export async function generateFlashcards(request, env) {
  const user = await requireUser(request, env);
  const result = await aiContent.generateFlashcards(
    env,
    await readBody(request, { user }),
  );
  return json(result, 200, request);
}

export async function generateVocab(request, env) {
  const user = await requireUser(request, env);
  const result = await aiContent.generateVocab(
    env,
    await readBody(request, { user }),
  );
  return json(result, 200, request);
}

export async function generateComprehension(request, env) {
  const user = await requireUser(request, env);
  const result = await aiContent.generateComprehension(
    env,
    await readBody(request, { user }),
  );
  return json(result, 200, request);
}
