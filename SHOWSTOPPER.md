# Showstopper validation checklist

1. **Start Neo4j** (optional if you only want the vault + proposed flow):

   ```bash
   make neo4j-up
   ```

2. **Run the demo:**

   ```bash
   make demo              # vault + proposed queue only
   make demo-commit       # also pushes to Neo4j
   ```

3. **Verify the Obsidian note updated** —
   `vault/Jane-Commissioner.md` should show:
   - `sentiment_vector` lowered from the 0.95 baseline
   - a new entry appended to `source_lineage`
   - `last_updated` / `last_reconciled` refreshed

4. **Verify the conflict was flagged** —
   look for `vault/conflicts/Jane-Commissioner-CONFLICT-<today>.md`.
   It must contain previous vs. new sentiment and a reconciliation question.

5. **Verify the graph** —
   either inspect `vault/proposed/sync-*.json` for the newest node/edge list,
   or open the Neo4j browser at http://localhost:7474 and run:

   ```cypher
   MATCH (e:Entity)-[r]->(t)
   RETURN e.name, type(r), t.name
   LIMIT 25;
   ```

6. **Verify the Red Team output** —
   `vault/action_plans/Pathfinder-Action-Plan-<today>.md` should call out
   Jane Commissioner as "At Risk due to Institutional Inertia" and recommend
   dispatching a network engineer.

7. **Optional dashboard sanity check:**

   ```bash
   make run &
   make dashboard
   ```

   Visit http://localhost:5173 — the stakeholder cards should show the radial
   gauges driven by `influence_score` / `sentiment_vector`, and the Conflicts
   and Action Plans panels should list the newly created markdown files.
