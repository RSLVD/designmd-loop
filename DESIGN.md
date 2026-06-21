---
version: alpha
name: Meridian
description: A calm editorial product surface. Warm paper, near-black ink set boldly, and one quiet blue that does all the pointing. A fictional design system used as the demo for designmd-loop.
colors:
  primary: "#1b1b1a"
  bg: "#f6f4ef"
  surface: "#ffffff"
  ink: "#1b1b1a"
  muted: "#6b6a66"
  accent: "#3a6ea5"
  accent-strong: "#2c5680"
  line: "rgba(27, 27, 26, 0.12)"
typography:
  h1:
    fontFamily: Inter
    fontSize: 3rem
    fontWeight: 600
    letterSpacing: -0.02em
  body-md:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  label-caps:
    fontFamily: IBM Plex Mono
    fontSize: 0.75rem
    fontWeight: 500
    letterSpacing: 0.08em
rounded:
  sm: 4px
spacing:
  block: 16px
  section: 72px
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
    rounded: "{rounded.sm}"
    padding: 12px
  link-text:
    textColor: "{colors.accent}"
  eyebrow:
    textColor: "{colors.accent}"
    typography: "{typography.label-caps}"
# Custom extension key: values this system has deliberately retired. The gate fails any of these.
retired:
  - "#000000"
  - "#ffffff00"
  - "#7df2b0"
---

## Overview

Meridian is a calm, editorial product surface. The reference is a well-set quarterly report: warm paper, generous margins, near-black ink used with confidence, and a single restrained blue that marks anything interactive. It is not a neon dashboard and not a glassy SaaS hero. Restraint is the whole identity.

## Colors

A single-ink-plus-one-accent system on warm paper.

- **Paper** {colors.bg} is the ground, warm off-white, never pure black.
- **Ink** {colors.ink} (also primary) carries all type and primary actions. Used boldly.
- **Accent** {colors.accent} is the only color that points: links, eyebrows, focus. {colors.accent-strong} is its pressed state. It stays scarce.
- **Muted** {colors.muted} is for secondary copy. **Line** {colors.line} is a hairline, not a shadow.

## Typography

Inter for display and body, IBM Plex Mono for small uppercase labels. Modest sizes, generous spacing.

## Components

- **button-primary** is solid ink on paper text.
- **link-text** and **eyebrow** are where the accent lives.

## Do's and Don'ts

- **Do** keep the accent scarce. Its restraint is what makes it read as intentional.
- **Do** use ink boldly: large type, solid near-black buttons.
- **Don't** use pure black ground or a retired value (see the `retired` list).
- **Don't** add glows, gradients, or glass. Depth is hairlines and whitespace.
