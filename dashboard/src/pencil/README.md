# Pencil.dev drop zone

Paste Pencil-exported React components (TSX) here. Each component should accept
props mapped from the Pathfinder BFF:

- `influenceScore: number` (0-1) — mapped from Obsidian YAML `influence_score`
- `sentimentVector: number` (0-1) — mapped from Obsidian YAML `sentiment_vector`
- `stakeholder: Stakeholder` — see `../api.ts` for the full type

Import them from `src/App.tsx` to replace the default `StakeholderCard` layout.
