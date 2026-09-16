# Agent instructions

Use this file as the project-specific operating guide for coding agents.
Replace bracketed placeholders with repository-specific details as the project develops.

## Project overview

- Project: Reaction Room
- Purpose: Temporary-name audience reactions collected and delivered through a generic event feed.
- Primary stack: Node.js standard library, HTML, CSS, and browser JavaScript.
- Entry points: `server.js`, `public/index.html`

## Repository layout

```text
server.js       HTTP API, temporary sessions, and generic event publishing
public/         Browser UI for audience and presenter views
README.md       Local setup and behavior notes
```

## Development commands

```sh
# Install dependencies (none beyond Node.js)
npm install

# Run the application
npm start

# Run syntax checks
node --check server.js && node --check public/app.js

# Development mode
npm run dev
```

## Implementation guidelines

- Keep changes focused on the requested task.
- Follow the existing naming, formatting, and module conventions.
- Prefer the simplest implementation that satisfies the requirements.
- Add or update tests for behavior changes.
- Do not commit secrets, generated artifacts, or local environment files.

## Verification checklist

Before handing off a change:

- [ ] Relevant tests pass.
- [ ] Formatting and lint checks pass.
- [ ] Documentation is updated when behavior or setup changes.
- [ ] The final diff contains only task-related changes.

## Scope and safety

- Ask before making destructive or irreversible changes.
- Preserve unrelated user changes in the working tree.
- If a requirement is ambiguous, state the assumption or ask for clarification.
