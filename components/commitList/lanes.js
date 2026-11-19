// Lane layout for the modern commit list. Plain CommonJS, no browser dependencies.
//
// "Straight branches" algorithm from P. Vigier, "Commit graph drawing algorithms" (2019):
// https://pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html
//
// - Rows are the input order (newest first, every parent below its children).
// - Columns: a commit takes over the column of one of its branch children (children whose
//   first parent it is), so a branch stays in one column. Without a usable branch child it takes
//   the first free column, or a new one. Columns are never shifted, only freed and reused.
// - A commit never takes a column that is "forbidden": occupied between its row and the row of
//   its topmost merge child (children of which it is not the first parent), because its merge
//   edges travel up its own column and would cross whatever sits there.
// - Edges: a branch edge runs down the child's column and bends into the parent on the parent's
//   row; a merge edge bends out of the child on the child's row and runs down the parent's column.
const LANE_COLORS = ['#4c9aff', '#a371f7', '#3fb950', '#f0883e', '#db61a2'];

const laneColor = (lane) => LANE_COLORS[lane % LANE_COLORS.length];

// Vertical anchors inside a row.
const TOP = 0;
const MID = 1;
const BOTTOM = 2;

// commits: [{ sha1, parents: [sha1] }] newest first.
// Returns one { dot, tip, width, segs } per commit: tip is the row of the branch tip whose
// straight line the commit sits on (itself for a tip), and segs are the pieces of edges drawn in that
// row: { c1, y1, c2, y2, color, dashed } with c = column and y = TOP | MID | BOTTOM.
const computeLanes = (commits) => {
  const n = commits.length;
  const rowOf = new Map();
  commits.forEach((c, i) => rowOf.set(c.sha1, i));

  // Parents outside the list get virtual rows below it, so their columns are reserved like any
  // other; nothing is drawn for those rows.
  const all = commits.slice();
  commits.forEach((c) =>
    c.parents.forEach((p) => {
      if (!rowOf.has(p)) {
        rowOf.set(p, all.length);
        all.push({ sha1: p, parents: [], virtual: true });
      }
    })
  );

  const branchKids = all.map(() => []); // rows of children whose first parent is this commit
  const mergeKids = all.map(() => []); // rows of the other children
  all.forEach((c, i) =>
    c.parents.forEach((p, k) => (k === 0 ? branchKids : mergeKids)[rowOf.get(p)].push(i))
  );

  const col = new Array(all.length);
  const tip = new Array(all.length); // row of the topmost commit of the straight run (branch tip)
  const active = []; // active[j] = row of the commit whose line currently runs down column j
  const intervals = []; // intervals[j] = [{ row, start, end }] lines drawn in column j

  const occupy = (j, row, i) => {
    active[j] = row;
    (intervals[j] = intervals[j] || []).push({ row, start: i, end: Infinity });
  };
  const release = (j, i) => {
    const list = intervals[j];
    list[list.length - 1].end = i - 1;
    active[j] = null;
  };

  for (let i = 0; i < all.length; i++) {
    const kids = branchKids[i];
    const kidSet = new Set(kids);
    const forbidden = new Set();
    if (mergeKids[i].length) {
      const top = Math.min(...mergeKids[i]);
      intervals.forEach((list, j) => {
        const blocked = list.some(
          (it) =>
            it.start <= i - 1 &&
            it.end >= top &&
            // the line of a branch child that started above the merge child is our own branch
            !(kidSet.has(it.row) && it.start < top)
        );
        if (blocked) forbidden.add(j);
      });
    }

    const usable = kids
      .map((r) => col[r])
      .filter((j) => !forbidden.has(j))
      .sort((a, b) => a - b);
    let j;
    if (usable.length) {
      j = usable[0];
    } else {
      j = 0;
      while (
        j < active.length &&
        ((active[j] !== null && active[j] !== undefined) || forbidden.has(j))
      )
        j++;
    }
    kids.forEach((r) => {
      if (active[col[r]] === r) release(col[r], i);
    });
    if (active[j] !== null && active[j] !== undefined) release(j, i);
    tip[i] = usable.length ? tip[kids.find((r) => col[r] === j)] : i;
    col[i] = j;
    occupy(j, i, i);
    // a commit without parents ends its line on its own row
    if (!all[i].parents.length) release(j, i + 1);
  }

  const rows = commits.map((c, i) => ({ dot: col[i], tip: tip[i], width: col[i] + 1, segs: [] }));
  const add = (r, seg) => {
    if (r >= n) return;
    rows[r].segs.push(seg);
    rows[r].width = Math.max(rows[r].width, seg.c1 + 1, seg.c2 + 1);
  };

  commits.forEach((c, i) => {
    const jc = col[i];
    const dashed = c.sha1 === 'WIP';
    c.parents.forEach((p, k) => {
      const rp = rowOf.get(p);
      const jp = col[rp];
      if (k === 0) {
        // branch edge: down the child's column, bends into the parent on the parent's row
        const color = laneColor(jc);
        add(i, { c1: jc, y1: MID, c2: jc, y2: BOTTOM, color, dashed });
        for (let r = i + 1; r < rp; r++) add(r, { c1: jc, y1: TOP, c2: jc, y2: BOTTOM, color });
        add(rp, { c1: jc, y1: TOP, c2: jp, y2: MID, color });
      } else {
        // merge edge: bends out of the child on its row, then down the parent's column
        const color = laneColor(jp);
        add(i, { c1: jc, y1: MID, c2: jp, y2: BOTTOM, color, dashed });
        for (let r = i + 1; r < rp; r++) add(r, { c1: jp, y1: TOP, c2: jp, y2: BOTTOM, color });
        add(rp, { c1: jp, y1: TOP, c2: jp, y2: MID, color });
      }
    });
  });
  return rows;
};

module.exports = { computeLanes, laneColor, TOP, MID, BOTTOM };
