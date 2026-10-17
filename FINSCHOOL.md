# FinSchool fork of Twenty

| | |
|---|---|
| **Branch** | `finschool/main` |
| **Upstream** | `https://github.com/twentyhq/twenty.git` |
| **Pinned** | tag `v2.9.0` (commit `b53f1832`) |
| **Packaging** | [`finschool/`](./finschool/) |

This tree is a **source fork**. Deployable image starts as upstream Docker + `finschool/overlay`; product changes land in `packages/` on this branch.

After creating a GitHub fork:

```bash
git remote add origin git@github.com:<org>/twenty-finschool.git
git push -u origin finschool/main
```
