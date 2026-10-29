# dsh-identity

A **DSH (DeepSeek Harness) identity plugin**: one editable kernel, evidence-based traits, event stream, dual-card memory, diary/reflection, promises, mood v2 (tone + content + behaviour), autonomy proposals, governance (policy/limits/confirm codes/scheduler/budget/payments), and a capability runtime.

**QQ (NapCat / OneBot 11) is only the first channel.** Core layers never import QQ code; web sessions get identity and growth through the host `session/event` bus.

## Install (DSH plugin)

### From GitHub (recommended)

```powershell
dsh plugin --profile desktop add github:Anarrogantcat/dsh-identity
```

Then make sure `dsh-identity` is in the profile bundles and restart DSH.

### Local / npm

```powershell
dsh plugin --profile desktop add file:C:\path\to\dsh-identity
# after publishing: dsh plugin --profile desktop add dsh-identity
```

The package is **not published to npm** yet; use `github:` or a local `file:` path.

No third-party persona/mood plugin required. Data lives in `~/.dsh/storages/dsh-identity`.

## Test

```bash
npm install
npm test
```

130 test files, including UI render smoke (19 pages) and interaction smoke (every button clicked).

MIT
