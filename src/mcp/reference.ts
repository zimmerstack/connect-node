import { REFERENCE, type ReferenceOperation } from "./reference.generated.ts";

/**
 * Lookups over the reference the generator wrote from the API's contract: an operation, a type, a
 * topic, or a search across all three. Pure text in, text out; the MCP server only wraps these.
 */

const json = (value: unknown): string => JSON.stringify(value, null, 2);
const withoutComments = (text: string): string => text.replace(/\/\*\*[^]*?\*\//g, "");

export const TOPICS: string[] = Object.keys(REFERENCE.topics);

/** The types an expression names, then the types those name, each once, in the order met. */
function typesNamed(expression: string, seen: Set<string> = new Set()): string[] {
  for (const name of Object.keys(REFERENCE.types)) {
    if (seen.has(name) || !new RegExp(`\\b${name}\\b`).test(expression)) continue;
    seen.add(name);
    typesNamed(withoutComments(REFERENCE.types[name] ?? ""), seen);
  }
  return [...seen];
}

const typeBlock = (expression: string | null): string =>
  expression === null
    ? ""
    : typesNamed(expression)
        .map((name) => REFERENCE.types[name])
        .join("\n\n");

/** An operation by its contract name ("PUT /rates", any letter case), its path alone when one method has it, or the client's call ("zs.rates.set"). */
export function findOperation(input: string): ReferenceOperation | undefined {
  const wanted = input.trim().replace(/\s+/g, " ");
  if (!wanted) return undefined;
  if (/^zs\./.test(wanted)) {
    // A method has one first name and may have others (zs.ratePlans.delete, zs.catalog.deleteRatePlan): either finds it.
    const call = wanted.split("(")[0];
    const named = (text: string) => text.split("(")[0] === call;
    return REFERENCE.operations.find((op) => named(op.call)) ?? REFERENCE.operations.find((op) => op.also.some(named));
  }
  const [first = "", second] = wanted.split(" ");
  if (second !== undefined) return REFERENCE.operations.find((op) => op.key === `${first.toUpperCase()} ${second}`);
  const byPath = REFERENCE.operations.filter((op) => op.key.split(" ")[1] === first);
  return byPath.length === 1 ? byPath[0] : undefined;
}

export function describeOperation(op: ReferenceOperation): string {
  const lines: string[] = [
    `${op.key}: ${op.summary}`,
    "",
    `With the package: ${op.call}`,
    ...(op.also.length ? [`Also: ${op.also.join(", ")}`] : []),
    `Scope: ${op.scope ?? "none (every key may call it)"}`,
    op.key.startsWith("GET ")
      ? "A read: safe to repeat."
      : op.idempotent
        ? "A write the server keeps an idempotency record for: the client sends a key and reuses it on its own retries."
        : "A write with no idempotency record: the client does not resend it when its outcome is unknown.",
  ];
  if (op.description) lines.push("", op.description);
  if (op.path.length) lines.push("", `Path values: ${op.path.join(", ")}`);
  if (op.query.length) {
    lines.push("", "Query:");
    for (const q of op.query) lines.push(`- ${q.name}${q.required ? "" : "?"}: ${q.type}${q.description ? `. ${q.description}` : ""}`);
  }
  if (op.body !== null) {
    lines.push("", `Body: ${/^[A-Za-z]+$/.test(op.body) ? op.body : "an object"}`, "", "```ts", typeBlock(op.body) || op.body, "```");
    if (op.request !== null) lines.push("", "Sample body:", "```json", json(op.request), "```");
  }
  lines.push("", `Answers ${op.answerStatus.join(" or ")} with data: ${op.response}`);
  const answerTypes = typeBlock(op.response);
  if (answerTypes) lines.push("", "```ts", answerTypes, "```");
  if (op.answer !== null) lines.push("", "Sample answer (data):", "```json", json(op.answer), "```");
  if (op.refusals.length) {
    lines.push("", "Refusals:");
    for (const r of op.refusals) lines.push(`- ${r.status}: ${r.description}`);
  }
  return lines.join("\n");
}

export function describeType(name: string): string | undefined {
  const exact = Object.keys(REFERENCE.types).find((n) => n.toLowerCase() === name.trim().toLowerCase());
  return exact ? ["```ts", typeBlock(exact), "```"].join("\n") : undefined;
}

export function describeTopic(name: string): string | undefined {
  const text = REFERENCE.topics[name.trim().toLowerCase()];
  return text === undefined ? undefined : `# ${name.trim().toLowerCase()}\n\n${text}`;
}

/** What there is to look up. */
export function referenceIndex(): string {
  const lines: string[] = [
    `${REFERENCE.api}. Base URL: ${REFERENCE.base}`,
    "",
    "Operations (ask for one by its name, e.g. operation: \"PUT /rates\"):",
    ...REFERENCE.operations.map((op) => `- ${op.key}: ${op.summary} [${op.scope ?? "any key"}] → ${op.call}`),
    "",
    `Topics (ask with topic): ${TOPICS.join(", ")}`,
    "",
    `Types (ask with type): ${Object.keys(REFERENCE.types).join(", ")}`,
    "",
    "Or search across all of it with search: \"minimum stay\", \"429\", \"RATE_OUT_OF_BAND\", …",
  ];
  return lines.join("\n");
}

const SMALL_WORDS = new Set(["a", "an", "the", "to", "of", "in", "on", "for", "and", "or", "is", "it", "do", "how", "what", "can", "with", "my"]);

/** The operations, topics and types that mention the most words of the query, best first. */
export function searchReference(query: string): string {
  const words = [...new Set(query.toLowerCase().split(/[^a-z0-9_:/{}.-]+/).filter((w) => w.length > 1 && !SMALL_WORDS.has(w)))];
  if (words.length === 0) return referenceIndex();
  const entries: Array<{ label: string; open: string; text: string }> = [
    ...REFERENCE.operations.map((op) => ({ label: `${op.key}: ${op.summary}`, open: `operation: "${op.key}"`, text: [op.key, op.summary, op.description, op.call, ...op.also, op.scope ?? "", REFERENCE.types[op.body ?? ""] ?? op.body ?? "", ...op.refusals.map((r) => r.description), ...op.query.map((q) => `${q.name} ${q.description}`)].join(" ") })),
    ...Object.entries(REFERENCE.topics).map(([name, text]) => ({ label: `topic ${name}`, open: `topic: "${name}"`, text: `${name} ${text}` })),
    ...Object.entries(REFERENCE.types).map(([name, text]) => ({ label: `type ${name}`, open: `type: "${name}"`, text: `${name} ${text}` })),
  ];
  // A word in the name counts double: "rates" should find PUT /rates before a topic that mentions rates in passing.
  const scored = entries
    .map((e) => {
      const text = e.text.toLowerCase();
      const label = e.label.toLowerCase();
      const found = words.filter((w) => text.includes(w));
      return { ...e, found, score: found.length + found.filter((w) => label.includes(w)).length };
    })
    .filter((e) => e.found.length > 0)
    .sort((a, b) => b.found.length - a.found.length || b.score - a.score);
  if (scored.length === 0) return `Nothing in the reference mentions "${query}". The index:\n\n${referenceIndex()}`;

  const best = scored[0]!.found.length;
  const shown = scored.filter((e) => e.found.length >= Math.max(1, best - 1)).slice(0, 8);
  const lines = [`${best === words.length ? "Mentions" : "Closest to"} "${query}":`, ""];
  for (const e of shown) {
    lines.push(`- ${e.label}  (open with ${e.open})`);
    // The words around the first one found, so the answer is often on this line already.
    const at = e.text.toLowerCase().indexOf(e.found[0] ?? "");
    const snippet = withoutComments(e.text.slice(Math.max(0, at - 90), at + 170)).replace(/\s+/g, " ").trim();
    if (snippet) lines.push(`  …${snippet}…`);
  }
  return lines.join("\n");
}
