// Lane layout for the modern commit list. Plain CommonJS, no browser dependencies.
const LANE_COLORS = ['#4c9aff', '#a371f7', '#3fb950', '#f0883e', '#db61a2'];

const laneColor = (lane) => LANE_COLORS[lane % LANE_COLORS.length];

const firstFree = (active, skip) => {
  let l = 0;
  while (l < active.length && (active[l] !== null || l === skip)) l++;
  return l;
};

// commits: [{ sha1, parents: [sha1] }] newest first.
// Returns one { dot, up, down, pass, width } per commit.
const computeLanes = (commits) => {
  const active = []; // active[l] = sha expected in lane l, or null
  return commits.map((commit) => {
    const up = [];
    const pass = [];
    active.forEach((sha, l) => {
      if (sha === commit.sha1) up.push(l);
      else if (sha !== null && sha !== undefined) pass.push(l);
    });
    const dot = up.length ? up[0] : firstFree(active, -1);
    up.forEach((l) => (active[l] = null));

    const down = [];
    commit.parents.forEach((p, i) => {
      if (i === 0) {
        active[dot] = p;
        down.push(dot);
        return;
      }
      const existing = active.indexOf(p);
      if (existing !== -1) {
        down.push(existing);
      } else {
        const l = firstFree(active, dot);
        active[l] = p;
        down.push(l);
      }
    });
    for (let l = 0; l < active.length; l++) if (active[l] === undefined) active[l] = null;
    while (active.length && active[active.length - 1] === null) active.pop();

    const width = Math.max(dot, ...up, ...down, ...pass) + 1;
    return { dot, up, down, pass, width };
  });
};

module.exports = { computeLanes, laneColor };
