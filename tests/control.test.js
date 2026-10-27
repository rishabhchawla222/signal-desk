// Control client tests with a fake GitHub API. Run: node --test tests/control.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../docs/trade/control.js");

function fakeGitHub({ conflictsFirst = 0, failNetwork = false, status = 200 } = {}) {
  const files = { "control/commands.json": { sha: "s1", text: JSON.stringify({ commands: [] }) } };
  let conflicts = conflictsFirst, puts = 0;
  const fetch = async (url, init = {}) => {
    if (failNetwork) throw new TypeError("network down");
    if (status !== 200) return { status, ok: false, json: async () => ({}) };
    const m = url.match(/\/contents\/([^?]+)(?:\?ref=(.+))?$/);
    if (init.method === "PUT") {
      puts++;
      const body = JSON.parse(init.body);
      const key = `${body.branch}/${m[1]}`;
      if (conflicts > 0) { conflicts--; files[key].sha = "changed"; return { status: 409, ok: false }; }
      if (body.sha !== files[key].sha) return { status: 409, ok: false };
      files[key] = { sha: "s" + (puts + 1), text: C.b64decode(body.content) };
      return { status: 200, ok: true, json: async () => ({}) };
    }
    if (m) {
      const f = files[`${decodeURIComponent(m[2])}/${m[1]}`];
      if (!f) return { status: 404, ok: false };
      return { status: 200, ok: true, json: async () => ({ sha: f.sha, content: C.b64encode(f.text) }) };
    }
    return { status: 200, ok: true, json: async () => ({ full_name: "me/signal-desk", permissions: { push: true } }) };
  };
  const client = C.create({ fetch, repo: () => ({ owner: "me", repo: "signal-desk" }), token: () => "t" });
  return { client, files, puts: () => puts };
}
const cmds = f => JSON.parse(f["control/commands.json"].text).commands;

test("send stores the command once even if retried (idempotent by id)", async () => {
  const g = fakeGitHub();
  const cmd = { id: "c-1", type: "EXIT", target: "NIFTY-1", ts: "t" };
  await g.client.send(cmd);
  const again = await g.client.send(cmd);
  assert.equal(again.duplicate, true);
  assert.equal(cmds(g.files).length, 1);
});

test("write conflict re-reads and retries", async () => {
  const g = fakeGitHub({ conflictsFirst: 2 });
  await g.client.send({ id: "c-2", type: "PAUSE", ts: "t" });
  assert.equal(cmds(g.files).length, 1);
});

test("network failure is reported, nothing stored", async () => {
  const g = fakeGitHub({ failNetwork: true });
  await assert.rejects(g.client.send({ id: "c-3", type: "PAUSE" }), e => e.code === "network");
});

test("bad token and missing permission give clear errors", async () => {
  await assert.rejects(fakeGitHub({ status: 401 }).client.send({ id: "x", type: "PAUSE" }), e => e.code === "auth");
  await assert.rejects(fakeGitHub({ status: 403 }).client.send({ id: "x", type: "PAUSE" }), e => e.code === "forbidden");
});

test("no token: refuses before calling GitHub", async () => {
  const c = C.create({ fetch: async () => { throw new Error("should not call"); }, repo: () => ({ owner: "a", repo: "b" }), token: () => "" });
  await assert.rejects(c.send({ id: "x", type: "PAUSE" }), e => e.code === "no_token");
});

test("check() validates token and control branch", async () => {
  const r = await fakeGitHub().client.check();
  assert.equal(r.ok, true);
});

test("unicode survives base64 round trip", () => {
  const s = JSON.stringify({ m: "₹ net −₹897.15" });
  assert.equal(C.b64decode(C.b64encode(s)), s);
});
