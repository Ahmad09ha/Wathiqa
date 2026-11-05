# وثيقة — Wathiqa Web

Next.js 16 + React 19 + Tiptap + Lenis. This is the Arabic RTL frontend for **وثيقة**, a local-first document-template workspace.

## Development

From the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

The UI uses `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:5088`). It requires the .NET API and PostgreSQL to be running for template and document operations.

Use `npm run lint` for TypeScript checks and `npm run build` for a production build. See the root [README](../README.md) for the complete local setup, backend and limitations.

The original Chinese/English contract content is preserved; only application chrome is translated to Arabic.
