# Deferred GitHub config

The `ci.yml` workflow in this directory is ready to drop into `.github/workflows/`. It runs typecheck + build on the web app and a Python compileall sanity check on the Garmin service.

It's parked here because the GitHub OAuth token used to create this repo doesn't carry the `workflow` scope, so a push that includes a workflow file gets rejected. To enable:

```bash
gh auth refresh -s workflow,repo
mkdir -p .github/workflows
mv .github-deferred/ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git rm -r .github-deferred
git commit -m "Enable CI workflow"
git push
```
