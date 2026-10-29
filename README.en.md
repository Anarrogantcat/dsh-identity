# dsh-identity

A **DSH (DeepSeek Harness) identity plugin**: one editable kernel, evidence-based traits, event stream, dual-card memory, diary/reflection, promises, mood v2 (tone + content + behaviour), autonomy proposals, governance (policy/limits/confirm codes/scheduler/budget/payments), and a capability runtime.

**QQ (NapCat / OneBot 11) is only the first channel.** Core layers never import QQ code; web sessions get identity and growth through the host `session/event` bus.

## Install (DSH plugin)

1. Place the repo at `~/.dsh/plugins/dsh-identity`
2. Add `"dsh-identity": "file:../../plugins/dsh-identity"` to the profile
3. Add `dsh-identity` to bundles (or use the bundle patch in `cordis.patch.yml`)
4. Restart DSH; open the panel via the 🐟 floater or `/qqbot-refine`

No third-party persona/mood plugin required. Data lives in `~/.dsh/storages/dsh-identity`.

## Test

```bash
npm install
npm test
```

130 test files, including UI render smoke (19 pages) and interaction smoke (every button clicked).

MIT
