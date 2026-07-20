# Frontend-specific guidance

- Keep browser-to-backend communication behind same-origin BFF Route Handlers under `app/api/**`; do not expose the Nest API directly to client components.
- Respect React Server Component boundaries. Add `"use client"` only when browser state, events or hooks require it.
- Reuse components in `components/ui` and tokens in `app/globals.css`; do not introduce ad-hoc visual tokens.
- Validate forms with React Hook Form and Zod, expose accessible field errors, and keep session data in the existing `iron-session` flow.
- Mock upstream API calls with MSW for frontend unit/integration tests; Playwright E2E tests must not depend on the live Nest API.
- When API types change, synchronize `openapi.json` from the backend and regenerate `lib/api/types.gen.ts`; never hand-edit generated types.
