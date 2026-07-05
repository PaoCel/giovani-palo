# Project Workflow

- Work from the real `main`: run `git fetch`, switch to `main`, then merge from `origin/main` before starting new work.
- Use merge or fast-forward merge, not rebase or force-push. Paolo and Codex are the only collaborators on this project.
- Prefer landing completed work directly on `main` for this project, then push/deploy from `main`, so deploys do not miss work left on side branches.
- Use `codex/...` branches only for temporary isolation while actively developing or protecting dirty local work; merge them back into `main` before considering the task done.
