// Helpers shared by the modern right panel components (commitDetails, stagingPanel).

// Five-cell +/- bar: array of 'a' (added), 'd' (removed) or '' (neutral) cell classes.
exports.bar5 = (additions, deletions) => {
  const a = parseInt(additions, 10) || 0;
  const d = parseInt(deletions, 10) || 0;
  const total = a + d || 1;
  const na = Math.round((a / total) * 5);
  const nd = Math.min(5 - na, Math.round((d / total) * 5));
  const cells = [];
  for (let i = 0; i < 5; i++) cells.push(i < na ? 'a' : i < na + nd ? 'd' : '');
  return cells;
};

exports.initialsOf = (name) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0][0];
  return letters.toUpperCase();
};
