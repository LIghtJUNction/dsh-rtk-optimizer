export function compact(text: string) {
  // Restrict stripping to CSI/OSC terminal escapes; ordinary source is never a target.
  const clean = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  const lines = clean.split('\n');
  const kept: string[] = [];
  let passed = 0;
  let duplicates = 0;
  for (const line of lines) {
    if (/^\s*(?:✓|✔|PASS\s+\S|ok\s+\d+\s+-)/.test(line) && !/fail|error|warn/i.test(line)) { passed++; continue; }
    if (line && kept.at(-1) === line && !/fail|error|warn|not ok/i.test(line)) { duplicates++; continue; }
    kept.push(line);
  }
  if (passed) kept.push(`[RTK: ${passed} individual passing-test output lines omitted; this is not a total-test count.]`);
  if (duplicates) kept.push(`[RTK: ${duplicates} consecutive duplicate output lines omitted.]`);
  const candidate = kept.join('\n');
  const output = Buffer.byteLength(candidate) < Buffer.byteLength(text) ? candidate : text;
  return { text: output, originalBytes: Buffer.byteLength(text), outputBytes: Buffer.byteLength(output), changed: output !== text };
}
