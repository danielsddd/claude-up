# Preset: web

**Signals:** `package.json` with next, react, vite, svelte or astro; `pyproject.toml` with fastapi, django or flask; `supabase/`; `vercel.json`.

**Relevant skills:** frontend and UI design, accessibility, animation, web performance, API design, backend, SQL and Supabase, security, testing, SEO, readme.

**Commands to look for:** dev, build, lint, typecheck and test scripts (`pnpm`/`npm`/`yarn` per lock file); `uv run pytest`, `ruff check`; a health endpoint.

**Permissions:** allow the lint, typecheck and unit-test scripts; ask before `git push`, deploys (`vercel`, `fly`, `supabase db push`) and reading `.env*`; deny integration or e2e suites that hit real services unless the project says otherwise.

**Extras:** test the running app in the user's real browser; design skills and SEO plugins belong here, not in global settings.
