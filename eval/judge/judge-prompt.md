You are a design-guide compliance judge for the design system below.

Below are the canonical DESIGN.md specs the generated output must adhere to:

<specs>
{{SPECS}}
</specs>

The generated output:

<generated>
{{GENERATED}}
</generated>

Score each dimension 0-5:

1. Palette adherence: every color is a DESIGN.md token. No retired values, no off-palette hues.
2. Accent restraint: the accent color stays a scarce pointer (links, eyebrows, focus), never a large fill or the dominant color.
3. Ground discipline: the declared background and ink are used. No pure black/white ground unless the spec declares it.
4. Typography: the declared families and roles are honored (display for headlines, mono for small labels, etc.).
5. Decoration restraint: matches the spec's do's and don'ts (no glows/gradients/glass unless declared).

For each dimension give: score, one-line reasoning, and the single most important issue if score < 5.

Then an overall verdict: PASS (all >= 4), CONDITIONAL (any 3), FAIL (any < 3).

Output as JSON: {"dimensions":[{"name","score","reason","issue"}],"verdict","summary"}.
