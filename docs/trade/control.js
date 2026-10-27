/*
 * Auto-trader control client.
 *
 * The auto-trader runs on GitHub Actions. The app talks to it through the
 * repository: commands are appended to `commands.json` on the `control` branch,
 * and the auto-trader reports results in `autotrade.json` on `signals-data`.
 *
 *  - Every command carries a unique id. Sending is idempotent: if the id is
 *    already in commands.json (e.g. a retry after a dropped connection) it is not
 *    added again, and the auto-trader applies each id at most once.
 *  - Writes use the file's sha (optimistic locking); a conflict re-reads and retries.
 *  - A command counts as "done" only when autotrade.json reports its result.
 *
 * Needs a fine-grained GitHub token with Contents: read & write on this repository.
 * The token stays in this browser's storage; it is never sent anywhere but api.github.com.
 */
(function (root) {
  "use strict";

  function b64decode(s) {
    const bin = atob(String(s).replace(/\n/g, ""));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function uid(prefix) {
    const r = (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return (prefix || "c") + "-" + r;
  }

  class ControlError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  function create(opts) {
    const fetchImpl = opts.fetch || root.fetch.bind(root);
    const repo = () => opts.repo();          // {owner, repo}
    const token = () => opts.token() || "";
    const api = "https://api.github.com";

    async function call(path, init) {
      const r = repo();
      if (!r) throw new ControlError("Repository unknown. Open the app from your GitHub Pages site.", "no_repo");
      if (!token()) throw new ControlError("Add your GitHub token in Settings to control the auto-trader.", "no_token");
      let res;
      try {
        res = await fetchImpl(`${api}/repos/${r.owner}/${r.repo}${path}`, {
          ...init,
          headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token()}`,
                     "X-GitHub-Api-Version": "2022-11-28", ...(init && init.headers) },
          cache: "no-store",
        });
      } catch (e) {
        throw new ControlError("Couldn't reach GitHub. Check your connection – nothing was changed.", "network");
      }
      if (res.status === 401) throw new ControlError("GitHub rejected the token. Create a new one in Settings.", "auth");
      if (res.status === 403) throw new ControlError("The token can't write to this repository (needs Contents: read & write).", "forbidden");
      return res;
    }

    async function readJson(branch, file) {
      const res = await call(`/contents/${file}?ref=${encodeURIComponent(branch)}`);
      if (res.status === 404) return { sha: null, json: null };
      if (!res.ok) throw new ControlError(`GitHub error ${res.status} reading ${file}.`, "http");
      const j = await res.json();
      return { sha: j.sha, json: JSON.parse(b64decode(j.content)) };
    }

    /** Append a command (idempotent by id). Resolves when GitHub has stored it. */
    async function send(cmd) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const { sha, json } = await readJson("control", "commands.json");
        const doc = json && Array.isArray(json.commands) ? json : { commands: [] };
        if (doc.commands.some(c => c.id === cmd.id)) return { stored: true, duplicate: true };
        doc.commands.push(cmd);
        if (doc.commands.length > 200) doc.commands = doc.commands.slice(-200);
        const body = { message: `app: ${cmd.type}${cmd.target ? " " + cmd.target : ""}`, branch: "control",
                       content: b64encode(JSON.stringify(doc, null, 1) + "\n") };
        if (sha) body.sha = sha;
        const res = await call(`/contents/commands.json`, { method: "PUT", body: JSON.stringify(body),
                                                            headers: { "Content-Type": "application/json" } });
        if (res.ok) return { stored: true };
        if (res.status === 409 || res.status === 422) continue;   // someone else wrote first: re-read and retry
        if (res.status === 404) throw new ControlError("The control branch is missing in your repository.", "no_branch");
        throw new ControlError(`GitHub error ${res.status} while sending.`, "http");
      }
      throw new ControlError("GitHub was busy; please try again.", "conflict");
    }

    /** Fresh auto-trader state (bypasses the 5-minute raw file cache). */
    async function autoState() {
      const { json } = await readJson("signals-data", "autotrade.json");
      return json;
    }

    /** Checks the token: can read the repo and write contents. */
    async function check() {
      const res = await call("");
      if (!res.ok) throw new ControlError(res.status === 404 ? "Repository not found for this token." : `GitHub error ${res.status}.`, "http");
      const j = await res.json();
      if (!(j.permissions && j.permissions.push)) throw new ControlError("Token works but can't write. Give it Contents: read & write.", "forbidden");
      const c = await readJson("control", "commands.json");
      if (!c.sha) throw new ControlError("Token works, but the control branch is missing.", "no_branch");
      return { ok: true, repo: j.full_name };
    }

    return { send, autoState, check, readJson };
  }

  const api = { create, uid, ControlError, b64encode, b64decode };
  root.SignalControl = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
