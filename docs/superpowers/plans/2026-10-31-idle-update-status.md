# Plan — idle update discovery HTTP response

1. Sol6.1 implementation worker owns the narrow panel response, frontend API/discovery adaptation and meaningful HTTP/native regression coverage. Parent reviews transport and lifecycle boundaries and writes these notes.
2. Independent Sol6.1 preview worker owns ignored private sample files only. Show native idle, active and genuine-error states with a synopsis; final captures wait for source freeze. Keep server4181 and all production data untouched.
3. Parent integrates and reviews the patch, runs focused/full relevant checks and Web build/type-check, and presents the corrected native preview. Preserve untracked project instructions/audit/mockup artifacts.
4. User explicitly authorized urgent main promotion once confirmed. After local checks and native preview pass, commit on test and fast-forward main to that exact commit. Wait exact-commit hosted browser/container validation before requesting the production GHCR workflow. Only Web needs updating; no daemon code changes. Do not monitor GHCR. No new version/tag is implied.
## Verification

- Actual Koa/router/protocol regression failed before the patch with HTTP500 for idle, and passes after with HTTP200 and data.task=null. The global null-body failure behavior remains unchanged.
- Integrated security437/437 and frontend settings399/399 pass, including54 native operation-card cases. Panel builds and frontend type-check/production build pass. No daemon code or contract changed.
- Native guarded preview: localhost4181/idle-task-preview.html?mode=dark. Parent reviewed the corrected idle screenshot and collapsible synopsis before rollout. Active/error/Refresh and dark/light desktop/phone evidence remain private and unshipped.
- User confirmed the Web-only scope and requested main promotion as quickly as possible after verification. The parent will reuse the exact promoted commit for hosted validation and production publishing.