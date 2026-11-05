# وثيقة | Wathiqa — GitHub Repository Setup

## Recommended repository identity

- **Repository:** `Wathiqa` (or lowercase `wathiqa`)
- **Display name:** وثيقة
- **Frontend package:** `wathiqa-web`
- **Backend project:** `backend/Wathiqa.Api/Wathiqa.Api.csproj`
- **Solution:** `Wathiqa.slnx`
- **App favicon and metadata:** branded for وثيقة
- **Branches:** `main` by default; use `dev` if you want a staging branch.
- **Visibility:** private is recommended until authentication and production hardening are implemented.

## Before connecting GitHub

The source currently lives at `D:\Works\PrivateWorks\Hussam`. That **existing local folder path is intentionally retained** so the active Rider session and PostgreSQL workspace keep working. The project identity inside it is Wathiqa.

The repository is **not yet connected to any remote**, and no GitHub push has been performed.

For the easiest first push, create a **new empty repository on GitHub** without checking the boxes for README, .gitignore or LICENSE (those are handled locally; a license has not been selected).

Once you have the GitHub repository URL, connect it to the local project using your preferred Git client or ask to connect it here. A standard first-time command flow is:

```powershell
cd D:\Works\PrivateWorks\Hussam
git init -b main
git add .
git status --short
git commit -m "Initialize Wathiqa workspace"
git remote add origin https://github.com/OWNER/Wathiqa.git
git push -u origin main
```

Replace `OWNER` with the actual GitHub account or organization. **Inspect `git status` before committing.**

If the GitHub repository already has an initial commit, do **not** force-push; reconcile its history first.

## Data and credentials

The project-level `.gitignore` excludes `.local/`, PostgreSQL data, the private credential file, npm dependencies, Next.js build artifacts, .NET outputs, logs and environment files. Do not upload databases, real customer contracts or secrets to GitHub.

The old development database is **preserved** on this Windows machine; it is not included in the repository. New local installs use `wathiqa_docs`; the existing installation keeps its previous database automatically.

A basic GitHub Actions workflow at `.github/workflows/ci.yml` runs .NET build, npm install, TypeScript checks and Next.js build on pull requests and pushes to `main` and `dev`. It does **not** run PostgreSQL/browser integration tests.

The application remains a **local MVP**, not ready for public Internet access without authentication, tenant permissions, database migrations and import hardening.
