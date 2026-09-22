/** Real evidence acceptance. Does not count queued tasks or fixtures as success. */
const base = process.env.MILO_URL || "http://127.0.0.1:3000";
const cases = [
  { id: "webb-true", question: "Verify exactly this statement: The James Webb Space Telescope launched on 25 December 2021.", expected: "supported" },
  { id: "webb-false", question: "Verify exactly this statement: The James Webb Space Telescope launched on 25 December 2019.", expected: "contradicted" },
  { id: "webb-false-zh", question: "只核实这个说法：韦伯望远镜在2019年12月25日发射。", expected: "contradicted" },
  { id: "nist-fips203", question: "Verify exactly this statement: NIST published FIPS 203 on August 13, 2024.", expected: "supported" },
  { id: "apollo11", question: "Verify exactly this statement: Apollo 11 first landed humans on the Moon on July 20, 1969.", expected: "supported" },
];

let failed = 0;
for (const sample of cases) {
  const started = Date.now();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.MILO_ACCESS_CODE) headers["x-milo-access-code"] = process.env.MILO_ACCESS_CODE;
  const response = await fetch(`${base}/api/checks`, { method: "POST", headers, body: JSON.stringify({ question: sample.question }) });
  const created = await response.json();
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!response.ok || !created.id || !cookie) { failed++; console.log(JSON.stringify({ id: sample.id, passed: false, phase: "create", status: response.status })); continue; }
  const events = await fetch(`${base}/api/checks/${created.id}/events`, { headers: { cookie }, signal: AbortSignal.timeout(190_000) });
  await events.text();
  const task = await (await fetch(`${base}/api/checks/${created.id}`, { headers: { cookie } })).json();
  const verdicts = task.claims?.map((claim: { verdict: string }) => claim.verdict) ?? [];
  const passed = task.status === "completed" && verdicts.length === 1 && verdicts[0] === sample.expected && task.claims.every((claim: any) => claim.quotes?.length && claim.quotes.every((quote: any) => {
    const source = task.evidence.find((item: any) => item.id === quote.sourceId && item.kind === "fetched");
    return source && (source.body ?? source.excerpt).includes(quote.text);
  }));
  if (!passed) failed++;
  console.log(JSON.stringify({ id: sample.id, passed, status: task.status, expected: sample.expected, verdicts, elapsedMs: Date.now() - started,
    claims: task.claims?.map((claim: any) => ({ text: claim.text, basis: claim.basis })), citations: task.claims?.flatMap((claim: any) => claim.quotes ?? []), sources: task.evidence?.filter((item: any) => item.kind === "fetched").map((item: any) => item.finalUrl), error: task.error }));
  await fetch(`${base}/api/checks/${created.id}`, { method: "DELETE", headers: { cookie } });
}
console.log(JSON.stringify({ evidencePassed: cases.length - failed, evidenceTotal: cases.length, voiceAcceptance: "NOT EXECUTED by this runner" }));
process.exitCode = failed ? 1 : 0;
