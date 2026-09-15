---
name: emotion-pose-pipeline
description: >-
  Generates stable 40-pose green-screen emotion portraits per character for
  neon-snake-girl (emotion_pose). Use when creating or redoing character
  emotion-poses, lock candidates A/B/C, batch 01-40, or updating
  EMOTION_POSE_READY_CHARACTERS / manifest under tex/juese/emotion-poses.
---

# Emotion Pose Pipeline

Project doc (full detail): `tex/juese/emotion-poses/PIPELINE.md`  
Catalog keys: `src/data/characterEmotionPoses.ts` → `EMOTION_POSE_CATALOG`

## Rule sync (mandatory)

If any fixed pipeline rule changes, update **all** of:

1. `tex/juese/emotion-poses/PIPELINE.md`
2. `GEN_SPEC.md` / `README.md` when summaries are affected
3. This skill folder (`.cursor/skills/emotion-pose-pipeline/`)
4. Personal copy `~/.cursor/skills/emotion-pose-pipeline/` (keep identical)

Do not leave Skill and MD out of sync.

## When to use

- 新角色表情姿 / 重做某角色 40 张
- 用户说「先出三个候选」「选 A/B/C 后开跑」「不要翅膀/加装备」

## Non-negotiables

1. Face = default skin **1:1** (use `_face-crop-default.png` if drift)
2. No clothes / no torso armor / no weapons — **fabric tops (camisole, tank, tube, straps, bows) are REJECT**; only the dark-grey digital GRID veil below chest is correct
3. Only default-skin cyber traits from lock
4. Mask = **below chest only**; dark-grey digital GRID; collarbones/shoulders/upper chest skin OK; **no skin visible through veil on lower torso** (opaque cover)
5. BG `#00b140`, 9:16, 2D anime
6. Every pose: **face emotion + light upper-body action**
7. Extra gear (CAST / **any white chest or shoulder armor plates**, wings unless in lock, guns, shields) → **reject & regen** — white armor counts as fail even if easy to miss
8. After user picks lock: **never change identity mid-batch**
9. Eye size: if user face refs show large moe eyes, keep high eye-to-face ratio; small eyes that age the face → reject
10. **No text / UI**: no subtitles, fonts, logos, borders, info panels, Game UI/HUD overlays — clean green-screen plate only; instant reject if present
11. **Must look at the image** after each generate before accepting (do not ship unread)


## Workflow checklist

```
- [ ] Phase A: folder + LOCK.md + default/face refs
- [ ] Phase B: candidates A/B/C → user pick → Generated_image + locks
- [ ] Phase C: batch 40 (5 parallel), QA, soft-retry once on block
- [ ] Phase D: manifest + READY_CHARACTERS + LOOK_ANCHORS + README
```

### Phase A — Setup

```
tex/juese/emotion-poses/{characterId}/
  LOCK.md, _default-skin.png, optional _face-crop-default.png
```

LOCK must list: hair/eyes/cyber side, bust, mask rule, forbid list.

### Phase B — Three lock candidates

Generate A/B/C in parallel (aside / forward / down glance).  
User selects → copy to:

- `Generated_image.png`
- `_ref-lock.png` / `_run-lock.png` / `_style-lock.png`

### Phase C — Batch 40

- Fixed master prompt; only swap `Face+upper body: …`
- Ref always `_run-lock.png` (or approved no-armor pose if safety blocks)
- Parallel **5**; QA each batch; regen rejects only
- Safety block: soften emotion wording, retry **1×**, don’t swap locks

### Phase D — Ship

1. Write `manifest.json` (`ready:true`, clone heartforge structure)
2. Add id to `EMOTION_POSE_READY_CHARACTERS`
3. Add `EMOTION_POSE_LOOK_ANCHORS[id]`
4. Update `tex/juese/emotion-poses/README.md`

## Master prompts

See [prompt-templates.md](prompt-templates.md).  
Upper-body action table: [emotion-actions.md](emotion-actions.md).

### Batch one-liner shape

```
Same character as reference EXACTLY. Flat 2D anime 9:16 green #00b140.
Identical face/hair/cyber from lock. Dark-grey GRID veil from chest line;
bare collarbones. NO CAST armor NO wings NO weapons NO extra gear.
Face+upper body: {key} — {face} + {upper-body action}.
NO text NO subtitles NO fonts NO logos NO borders NO HUD NO game UI.
Ultra sharp clean chroma plate.
```

## QA reject (must regen)

- Wings / back wings (unless lock has them)
- CAST / white chest armor / default full armor bleed
- Weapons, capes, extra gear
- **Any text / subtitles / fonts / logos / borders / info panels / Game UI / HUD overlays** (must be a clean green-screen character plate, never a character card)
- Face/hair mismatch or aged-up face
- Mask covers above chest / **fabric clothes or bodysuit instead of grid veil** (camisole, tank, tube top, straps, bows → instant reject)
- Face-only, no readable upper-body emotion gesture
- Green screen polluted

**Must visually inspect each batch image** before accepting. Text/UI bleed **or fabric clothes instead of grid veil** is an instant reject.

## Speed rules

- Fixed master + concurrent 5
- Don’t re-litigate identity mid-run
- Soften once on moderation block
- Operational `_run-lock` may be an approved pose; identity source remains `Generated_image.png`
