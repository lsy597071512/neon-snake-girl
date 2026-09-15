# Prompt templates

## Lock candidate (A/B/C)

```
Green-screen emotion-pose lock candidate for {nameZh} (portrait plate ONLY — not a UI card).
Flat 2D anime cel-shading, ultra sharp, 9:16.
FACE LOCK to default skin / face-crop: {hairEyesFace} — same proportions, do not age up or redesign.
Keep ONLY default cyber traits: {cyberTraits}.
Soft B{bust}.
NO clothes, NO torso armor, NO weapons.
Bare pale neck, shoulders, collarbones, and UPPER chest.
Frosted dark-grey translucent digital GRID veil ONLY below the chest line with pixel dissolve edges.
{glanceVariant}. Face is hero.
NO text, NO subtitles, NO fonts, NO logos, NO borders, NO HUD, NO info panels, NO game UI overlays.
Ultra sharp clean chroma plate.
```

Glance variants:

- A: Neutral cold looking slightly aside
- B: Quiet intense forward gaze, mouth closed
- C: Soft cold downward glance

If default armor bleeds: add `STRIP ALL white CAST armor plates` and optionally reference another character’s approved `_run-lock` **for veil style only**.

## Batch emotion pose

```
Same character as reference EXACTLY 1:1.
Flat 2D anime 9:16, solid green #00b140.
Keep identical youthful face, hair, temple/cyber traits from lock.
Dark-grey digital GRID veil from chest line down, bare collarbones.
NO white CAST armor, NO wings (unless in lock), NO weapons, NO extra gear.
Soft B{bust}.
Face+upper body: {key} — {faceCue} + {upperBodyCue}.
NO text, NO subtitles, NO fonts, NO logos, NO borders, NO HUD, NO info panels, NO game UI overlays.
Ultra sharp clean chroma plate.
```

## Short / safer (when blocks rise)

```
Same character portrait as the reference image, flat 2D anime, pure green #00b140.
Keep exact same face hair cyber and dark-grey grid veil below chest.
Only change: Face+upper body {faceCue} + {upperBodyCue}.
NO text NO UI panels. Ultra sharp 9:16 clean chroma plate.
```

## Soften examples (moderation)

| Harsh | Softer |
|-------|--------|
| despair hollow broken | pale empty distant eyes |
| panic terrified | wide eyes mouth ajar soft lean back |
| shame flushed | eyes cast down shoulders curled |
| bare chest / breasts | collarbones visible; veil under bust |
