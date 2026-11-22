# TREAD Web Applications

Next.js App Router applications for TREAD: a public landing page, institutional dashboard, and institution onboarding. The dashboard is a design preview and does not display fabricated balances or transaction results. The institution application form submits to the NestJS `/v1/onboarding/institutions` endpoint.

## Local preview

The static preview is available without Node frontend packages:

```sh
npm run preview:static
```

Open `http://localhost:3001` for the landing page, `/dashboard.html` for the institutional dashboard, and `/onboarding.html` for institution onboarding. The onboarding page posts to the NestJS API.

## Next.js development server

```sh
npm install
cp .env.example .env.local
npm run dev
```

The Next.js applications run on `http://localhost:3001`; the API defaults to `http://localhost:3000`. The current local Next.js native build exits with a bus error, so use the static preview until that runtime issue is resolved. In Next.js, `/` is the landing page and `/dashboard` is the institutional dashboard.
