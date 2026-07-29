// Coercing tool arguments into the shape the schema asked for.
//
// Not defensive programming — measured. Every single tool call in the phase-0
// probe carried at least one wrongly typed argument:
//
//   {"level":"3","limit":"10"}          strings, schema says integer
//   {"words":"[\"帮忙\",\"改变\"]"}      a JSON string, schema says array
//
// The model is consistent about this, so the fix is deterministic. Coercion
// only: this never rejects a call, because a repaired call that runs beats a
// rejected one that costs another model turn to retry. Genuinely unusable
// arguments are the service's business, where the real validation already lives.

function coerce(value, schema) {
  if (schema == null || value == null) return value;

  switch (schema.type) {
    case "integer":
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) return value;
      // Rounding has to apply to an already-numeric value too — a model that
      // sends level: 3.7 is as wrong as one that sends "3.7".
      return clamp(schema.type === "integer" ? Math.round(n) : n, schema);
    }

    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return value;

    case "array": {
      // The common failure: an array serialised into a string.
      let arr = value;
      if (typeof arr === "string") {
        const trimmed = arr.trim();
        if (trimmed.startsWith("[")) {
          try {
            arr = JSON.parse(trimmed);
          } catch {
            arr = splitList(trimmed.replace(/^\[|\]$/g, ""));
          }
        } else if (trimmed.includes(",")) {
          // A bare comma-separated list is the other thing models emit. Safe to
          // split here because these arrays hold Chinese words, which never
          // contain an ASCII comma — the separator cannot be content.
          arr = splitList(trimmed);
        } else {
          arr = trimmed ? [trimmed] : [];
        }
      }
      if (!Array.isArray(arr)) return value;
      const out = schema.items ? arr.map((v) => coerce(v, schema.items)) : arr;
      return typeof schema.maxItems === "number" ? out.slice(0, schema.maxItems) : out;
    }

    case "string":
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      return value;

    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return value;
      // `.args`, not the whole return — repairArgs answers { args, repaired },
      // and handing that back would make the tool's argument the wrapper rather
      // than the object. It fails silently: the service reads
      // `{ args: {...}, repaired: [] }` where it expected the value, so every
      // field is undefined and nothing throws. No tool declares a nested object
      // today, which is exactly why this could sit here unnoticed until one did.
      // The parent's same() still sees the change, so a nested repair is logged
      // under its own key.
      return repairArgs(schema, value).args;
    }

    default:
      return value;
  }
}

// Handles both ASCII and full-width commas — a model writing Chinese emits 、
// and ， as readily as ",".
function splitList(text) {
  return text
    .split(/[,，、]/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function clamp(n, schema) {
  if (typeof schema.minimum === "number" && n < schema.minimum) return schema.minimum;
  if (typeof schema.maximum === "number" && n > schema.maximum) return schema.maximum;
  return n;
}

/**
 * Repairs one call's arguments against its inputSchema.
 *
 * Returns the repaired object plus the names of fields that were changed, so a
 * rising repair rate is visible in logs rather than silently absorbed — that is
 * the signal a prompt or a model has regressed.
 */
export function repairArgs(schema, args) {
  if (!schema?.properties || typeof args !== "object" || args === null) {
    return { args: args ?? {}, repaired: [] };
  }

  const out = { ...args };
  const repaired = [];

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (!(key in out)) continue;
    const before = out[key];
    const after = coerce(before, propSchema);
    if (!same(before, after)) {
      out[key] = after;
      repaired.push(key);
    }
  }

  return { args: out, repaired };
}

function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
