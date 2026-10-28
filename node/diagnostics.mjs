export function documentDiagnostics(compiled, input) {
  const diagnostics = [];
  const seen = new Set();
  if (compiled.kind !== 'metric') {
    const collection = compiled.kind === 'trace' ? 'spans' : 'frames';
    const indices = new Map(input[collection].map((source, index) => [source.id, index]));
    for (const issue of [...(compiled.issues ?? []), ...compiled.hierarchy.issues]) {
      const key = JSON.stringify([issue.kind, issue.id, issue.parentId]);
      if (seen.has(key)) continue;
      seen.add(key);
      const missing = issue.kind === 'missing-parent';
      diagnostics.push({
        severity: 'warning',
        code: missing ? 'HIERARCHY_MISSING_PARENT' : 'TRACE_OUTSIDE_PARENT',
        path: `${collection}[${indices.get(issue.id)}]${missing ? '.parentId' : ''}`,
        message: missing
          ? 'Parent is absent from the supplied snapshot; this source remains a root.'
          : 'Span extends outside its supplied parent interval.'
      });
    }
  }
  return diagnostics.sort((a, b) => {
    const left = `${a.path}\0${a.code}`,
      right = `${b.path}\0${b.code}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
