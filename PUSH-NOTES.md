# rigpop-ink — repo notes

**Local repo:** `/home/user/rigpop-ink` · branch `main` · 2 commits
**Remote (once it exists):** `git@github.com:swapagrawal14/rigpop-ink.git`

## Why it is not pushed yet

The existing key `~/.ssh/id_ed25519_rigpop` is a **deploy key scoped to `rigpop-motion`** —
GitHub does not let one deploy key write to two repos, and the account has no other
credential in this sandbox. So the repo needs to be created and a fresh key attached once.

## Two minutes, once

1. github.com/new → name `rigpop-ink`, **empty** (no README, no .gitignore), Private or Public.
2. In that repo: Settings → Deploy keys → Add deploy key → paste this, tick *Allow write access*:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP8F2vE6oXVxeNOlMVZUewt496MnnvFUDxnvEcYV/bg4 rigpop-ink-deploy
```

3. Say the word and this pushes:

```bash
cd /home/user/rigpop-ink
git remote add origin git@github.com:swapagrawal14/rigpop-ink.git
GIT_SSH_COMMAND="ssh -i /home/user/.ssh/id_ed25519_rigpop2 -o IdentitiesOnly=yes" \
  git push -u origin main
```

`.git/config` is excluded from workspace snapshots, so after a session restart the remote
line above has to be re-applied — the push command is written to do both.

## Security

`~/.ssh/id_ed25519_rigpop2` lives inside the sandbox. Delete the deploy key on GitHub
(Settings → Deploy keys) and `rm -f ~/.ssh/id_ed25519_rigpop2*` here when the work is done.
