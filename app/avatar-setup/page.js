"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const AGES = ["young", "adult", "old"];
const AGE_LABELS = ["Young", "Adult", "Old"];
const TYPES = ["slim", "muscular", "large"];
const TYPE_LABELS = ["Slim", "Muscular", "Large"];

const SKIN_COLORS = ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5c3a21"];
// Used by every color slider (skin tone + all four part colors): a black-to-white grayscale ramp
// (so pure black, white, and every grey between are directly reachable) followed by a
// full-saturation hue sweep (S=100%, L=50%). Within the hue portion, each pair of adjacent stops
// is 60° apart, and a straight RGB lerp between two stops that are 60° apart on the HSL wheel is
// colorimetrically IDENTICAL to sweeping hue linearly between them (one channel fixed at 0, one
// fixed at 255, one ramping) — so plain linear interpolation (interpolateStops) reproduces a
// true, evenly-spaced rainbow with no need for real HSL math. This replaces the old hand-picked
// PART_COLORS stops, whose uneven hue spacing/lightness made interpolated colors look like a
// muddy "smudge" instead of clean color.
const RAINBOW_STOPS = [
  "#000000", "#ffffff", // grayscale ramp — 1 of the 8 segments below
  "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000", // hue sweep — 6 segments, wrapping back to red
];
// Fraction of the slider's width the grayscale ramp occupies (1 of the 8 total segments above) —
// used to translate a hue (0-360°) into the right position past that ramp, and back.
const GRAY_SEGMENT_FRACTION = 1 / 8;
function hueToT(hueDeg) {
  return GRAY_SEGMENT_FRACTION + (hueDeg / 360) * (1 - GRAY_SEGMENT_FRACTION);
}

// mouth/eyes/nose are fixed (always mouth-1/eyes-1/nose-1, uncolored) — no user choice, so they
// aren't in this list and never get a picker. Every other category allows "none" (option 0 — no
// layer drawn), toggled by clicking its already-selected option again; `default` is just the
// option it starts on (hair/shirt start with something picked, facewear/hat start empty).
const CATEGORIES = [
  { key: "hair", label: "Hair", count: 4, default: 1 },
  { key: "facewear", label: "Facewear", count: 4, default: 0 },
  { key: "shirt", label: "Shirt", count: 4, default: 1 },
  { key: "hat", label: "Hat", count: 4, default: 0 },
];
// Rendered as two side-by-side pairs (see .avatar-setup-pair-row), each with its own color
// swatches directly underneath — hair+facewear, then shirt+hat.
const PAIR_ROWS = [["hair", "facewear"], ["shirt", "hat"]];

const ASSET_BASE = "/assets/avatar/build";
const CANVAS_SIZE = 1080;

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Same status dot as the register page (see app/(auth)/register/page.js) — copied rather than
// shared, matching the auth pages' convention of each page being self-contained. Extended here
// with a third "pending" (grey) state, used only by the username field below since it's the only
// one with an async (debounced) check worth showing a distinct "still working on it" state for.
function ValidityDot({ show, ok, pending, reason }) {
  if (!show) return null;
  const cls = pending ? "pending" : ok ? "ok" : "bad";
  return (
    <div className={`auth-validity-dot ${cls}`}>
      {!pending && !ok && reason ? <div className="auth-validity-tooltip">{reason}</div> : null}
    </div>
  );
}

// Draggable 3-stop slider. While dragging, the thumb tracks the pointer continuously (dragPct,
// 0-100 — NOT snapped) so it stays exactly under the mouse; only on release does it compute the
// nearest stop and commit via onChange, then the thumb eases (CSS transition, since "dragging" —
// which suppresses that transition — is cleared) back to that stop's exact position, giving the
// "follows your mouse, then snaps" feel. The stop markers are purely visual (non-interactive) —
// all pointer handling lives on the track itself so a click and a drag both go through one path.
// Thumb radius, in px — the thumb's `left` is inset by this amount on each end (via clampedLeft
// below) so its circle never overhangs past either end of the track, instead of a plain `X%`
// (which centers the thumb ON the 0%/100% points, letting half of it hang off the track edge).
const STOP_THUMB_R = 8;
function clampedLeft(pct, radiusPx) {
  return `calc(${radiusPx}px + ${pct / 100} * (100% - ${radiusPx * 2}px))`;
}

function StopSlider({ stops, labels, value, onChange }) {
  const trackRef = useRef(null);
  const [dragPct, setDragPct] = useState(null); // 0-100 while actively dragging, else null
  const stopPct = (i) => (stops.length > 1 ? (i / (stops.length - 1)) * 100 : 0);

  function pctFromClientX(clientX) {
    const rect = trackRef.current.getBoundingClientRect();
    return Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
  }
  function nearestIndex(pct) {
    return Math.round((pct / 100) * (stops.length - 1));
  }

  // The thumb's visual position (dragPct) tracks the pointer continuously and un-snapped for the
  // whole drag, but the actual committed value (onChange — age/build, which drives the preview)
  // updates live the moment the nearest stop changes, not just on release, so the avatar switches
  // the instant you cross into the next option's zone. Calling onChange repeatedly with the same
  // still-nearest stop while lingering inside one zone is harmless — React bails out of the
  // redraw when the value hasn't actually changed. Releasing mid-drag leaves dragPct null again,
  // so the thumb's visual position falls back to whatever was last committed (i.e. it snaps).
  function handlePointerDown(e) {
    e.preventDefault();
    const commit = (pct) => {
      setDragPct(pct);
      const i = nearestIndex(pct);
      if (stops[i] !== undefined) onChange(stops[i]);
    };
    commit(pctFromClientX(e.clientX));
    const move = (me) => commit(pctFromClientX(me.clientX));
    const up = (ue) => {
      commit(pctFromClientX(ue.clientX));
      setDragPct(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const thumbPct = dragPct !== null ? dragPct : stopPct(stops.indexOf(value));

  return (
    <div className="avatar-setup-slider" ref={trackRef} onPointerDown={handlePointerDown}>
      <div
        className={`avatar-setup-slider-thumb ${dragPct !== null ? "dragging" : ""}`}
        style={{ left: clampedLeft(thumbPct, STOP_THUMB_R) }}
      />
      <div className="avatar-setup-slider-stops">
        {stops.map((s, i) => (
          <div key={s} className="avatar-setup-slider-stop" style={{ left: clampedLeft(stopPct(i), STOP_THUMB_R) }}>
            <span className={`avatar-setup-slider-stop-label ${s === value ? "active" : ""}`}>{labels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(rgb) {
  return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
// A color's hue, in degrees (0-360) — pass through hueToT to get the matching position along
// RAINBOW_STOPS's hue-sweep portion. Used to position the skin-tone slider's thumb under a preset
// swatch (whose color comes from SKIN_COLORS, not the rainbow itself) after clicking it.
function hexHue(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
// Linearly interpolates across a list of hex color stops at position t (0-1) — used by every
// ColorGradientSlider (skin tone + all four part colors), always sampling RAINBOW_STOPS.
function interpolateStops(stops, t) {
  const segments = stops.length - 1;
  const scaled = Math.min(segments, Math.max(0, t * segments));
  const i = Math.min(segments - 1, Math.floor(scaled));
  const localT = scaled - i;
  const c0 = hexToRgb(stops[i]);
  const c1 = hexToRgb(stops[i + 1]);
  return rgbToHex(c0.map((v, idx) => v + (c1[idx] - v) * localT));
}

// Continuous (not stepped) gradient slider — used for skin tone (alongside discrete presets) and,
// full-width, for every hair/shirt/facewear/hat color. Same pointerdown+drag-anywhere-on-track
// pattern as StopSlider, but reports a raw 0-1 position instead of snapping to fixed stops. The
// thumb is a hollow ring (border only, see CSS) so the gradient shows through at its exact
// position, and grows + hides the system cursor while actively dragging so you can closely
// inspect the color you're lined up on, reverting to normal on release.
const GRADIENT_THUMB_R = 7.5; // idle radius, px — half of 15px (see .avatar-setup-gradient-thumb)
const GRADIENT_THUMB_R_DRAGGING = 15; // half of the grown 30px size

// Vertical distance (px) from the track at which drag sensitivity has halved — the further the
// cursor strays above/below the track while dragging, the finer each pixel of horizontal motion
// scrubs the color, like the precision-drag behavior in Photoshop/Figma sliders.
const PRECISION_HALVING_DISTANCE_PX = 80;

function ColorGradientSlider({ stops, t, onChange }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  function tFromClientX(clientX) {
    const rect = trackRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }
  // The initial click jumps the thumb straight to the clicked position (dy is 0 right after a
  // click on the track, so this is identical to the old "jump to cursor" behavior). Every
  // subsequent move is then applied as an INCREMENTAL delta scaled by the current sensitivity,
  // rather than recomputing an absolute position from the drag's start point — that's what lets
  // sensitivity change smoothly mid-drag (as the cursor moves further from the track) without the
  // thumb jumping when the vertical distance changes.
  function handlePointerDown(e) {
    e.preventDefault();
    setDragging(true);
    document.body.classList.add("avatar-color-dragging");
    const rect = trackRef.current.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    let curT = tFromClientX(e.clientX);
    let lastX = e.clientX;
    onChange(curT);
    const move = (me) => {
      const dy = Math.abs(me.clientY - centerY);
      const sensitivity = Math.pow(0.5, dy / PRECISION_HALVING_DISTANCE_PX);
      curT = Math.min(1, Math.max(0, curT + ((me.clientX - lastX) * sensitivity) / rect.width));
      lastX = me.clientX;
      onChange(curT);
    };
    const up = () => {
      setDragging(false);
      document.body.classList.remove("avatar-color-dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const radius = dragging ? GRADIENT_THUMB_R_DRAGGING : GRADIENT_THUMB_R;
  return (
    <div className="avatar-setup-gradient-slider" ref={trackRef} onPointerDown={handlePointerDown}>
      {/* The true rainbow always renders, with a solid grey mask layered on top at rest —
          faded out on hover, and also while actively dragging (`active`, driven by the same
          `dragging` state as the thumb) so precision-scrubbing — which deliberately moves the
          cursor away from the track — doesn't flicker the mask back in the moment the pointer
          leaves the track's bounds. */}
      <div className="avatar-setup-gradient-bg" style={{ background: `linear-gradient(to right, ${stops.join(",")})` }} />
      <div className={`avatar-setup-gradient-mask ${dragging ? "active" : ""}`} />
      <div
        className={`avatar-setup-gradient-thumb ${dragging ? "dragging" : ""}`}
        style={{ left: clampedLeft(t * 100, radius), background: interpolateStops(stops, t) }}
      />
    </div>
  );
}

// Each asset is referenced repeatedly as config changes (e.g. re-picking a color redraws the
// same image) — cached by src so it's only ever fetched/decoded once.
const imageCache = new Map();
function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

// Preserves the greyscale asset's own shading/luminosity while applying an arbitrary flat hue,
// via "multiply" blending. Measured directly off the real assets (sharp stats on
// adult-slim.png): mean RGB ~227/255 — these are NOT a neutral-grey (~128) recolor mask, they're
// a pale/near-white base with shading painted only into true shadow creases (ears, under-chin,
// etc). Multiply is the right tool for exactly that convention: on an unshaded (near-white,
// ~1.0) pixel, target*1.0 = target — the flat color comes through untouched — while true shadow
// pixels (lower values) darken the target proportionally, since multiply only ever darkens or
// preserves, never lightens. (Two earlier attempts were wrong for this asset: the CSS "color"
// blend mode always keeps the BACKDROP's lightness and only borrows hue/saturation, so even the
// darkest swatch stayed pale; "hard-light" screens — lightens toward white — wherever the image
// is above 50% grey, and since this asset's mean is ~89%, nearly every pixel hit that branch and
// washed out toward white regardless of the target color.)
function drawRecolored(ctx, img, color, size) {
  const tmp = document.createElement("canvas");
  tmp.width = size;
  tmp.height = size;
  const tctx = tmp.getContext("2d");
  tctx.fillStyle = color;
  tctx.fillRect(0, 0, size, size);
  tctx.globalCompositeOperation = "multiply";
  tctx.drawImage(img, 0, 0, size, size);
  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(img, 0, 0, size, size);
  ctx.drawImage(tmp, 0, 0, size, size);
}

// Bottom-to-top stacking order — an assumption pending real art (see the plan this was built
// from); trivially reorderable, it's just this array. mouth/eyes/nose are fixed at option 1 with
// color:null (drawn raw, no recolor — see the redraw loop) since they have no user-facing choice.
function buildLayerList(config) {
  const { age, bodyType, skinColor, parts } = config;
  const layers = [{ src: `${ASSET_BASE}/${age}-${bodyType}.png`, color: skinColor }];
  const partColor = (key) => interpolateStops(RAINBOW_STOPS, parts[key].colorT);
  if (parts.shirt.option > 0) layers.push({ src: `${ASSET_BASE}/shirt-${parts.shirt.option}.png`, color: partColor("shirt") });
  layers.push({ src: `${ASSET_BASE}/mouth-1.png`, color: null });
  layers.push({ src: `${ASSET_BASE}/nose-1.png`, color: null });
  layers.push({ src: `${ASSET_BASE}/eyes-1.png`, color: null });
  if (parts.hair.option > 0) layers.push({ src: `${ASSET_BASE}/hair-${parts.hair.option}.png`, color: partColor("hair") });
  if (parts.facewear.option > 0) layers.push({ src: `${ASSET_BASE}/facewear-${parts.facewear.option}.png`, color: partColor("facewear") });
  if (parts.hat.option > 0) layers.push({ src: `${ASSET_BASE}/hat-${parts.hat.option}.png`, color: partColor("hat") });
  return layers;
}

export default function AvatarSetupPage() {
  const router = useRouter();
  const canvasRef = useRef(null);
  const [age, setAge] = useState("adult");
  const [bodyType, setBodyType] = useState("slim");
  const [skinColor, setSkinColor] = useState(SKIN_COLORS[2]);
  // Position (0-1) along RAINBOW_STOPS — kept in sync with skinColor in both directions: picking
  // a preset (a SKIN_COLORS swatch, unrelated to the rainbow palette) snaps this to that swatch's
  // own hue position (via hexHue + hueToT); dragging the gradient slider derives skinColor from
  // this instead.
  const [skinSliderT, setSkinSliderT] = useState(hueToT(hexHue(SKIN_COLORS[2])));
  // colorT (0-1) is this part's position along RAINBOW_STOPS — the only place its color is ever
  // set is the gradient slider, so there's no separate hex field to keep in sync (unlike skin
  // tone, which also has discrete presets to reconcile against).
  const [parts, setParts] = useState(() =>
    Object.fromEntries(CATEGORIES.map((c) => [c.key, { option: c.default, colorT: 0.3 }]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // usernameInput always includes its leading "@" once non-empty (enforced in
  // handleUsernameChange) — empty shows the "@username" placeholder instead. Moved here from the
  // register page; validation rules (format/length/availability) are the same as they were there.
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState(null); // null = not yet confirmed
  // false the instant usernameInput changes (typing, or the focus-triggered "@") — grey/"pending"
  // dot state — and only flips true again once 500ms have passed with no further change, at
  // which point the dot resolves to a real red/green. Every keystroke restarts this from scratch.
  const [usernameSettled, setUsernameSettled] = useState(false);

  const username = usernameInput.replace(/^@/, "");
  const usernameFormatValid = /^[a-zA-Z0-9]+$/.test(username);
  const usernameLongEnough = username.length > 4;

  useEffect(() => {
    setUsernameSettled(false);
    if (!username) {
      // Nothing typed past the automatic "@" yet — stay pending (grey) indefinitely instead of
      // settling to red for a field the user hasn't actually touched.
      setUsernameAvailable(null);
      return;
    }
    if (!usernameFormatValid || !usernameLongEnough) {
      setUsernameAvailable(null);
      // No network round trip needed to know a too-short/bad-character username is invalid, but
      // still wait out the same 500ms before showing red — otherwise it'd flash red on literally
      // the first keystroke, before the settle delay other cases get.
      const t = setTimeout(() => setUsernameSettled(true), 500);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("is_username_available", { check_username: username });
      if (!cancelled) {
        setUsernameAvailable(error ? null : data);
        setUsernameSettled(true);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [usernameInput, username, usernameFormatValid, usernameLongEnough]);

  const usernameStatus = !usernameFormatValid
    ? { ok: false, reason: "use abc & 123" }
    : !usernameLongEnough
    ? { ok: false, reason: "too short" }
    : usernameAvailable === true
    ? { ok: true }
    : { ok: false, reason: usernameAvailable === false ? "unavailable" : "" };

  function handleUsernameFocus() {
    setUsernameFocused(true);
    if (!usernameInput) setUsernameInput("@");
  }
  function handleUsernameBlur() {
    setUsernameFocused(false);
    if (usernameInput === "@") setUsernameInput(""); // back to placeholder if nothing was typed
  }
  function handleUsernameChange(e) {
    // "@" is real text the user can't delete — any edit that would drop it (backspacing to
    // empty, selecting-all-and-typing, pasting over it, etc.) gets corrected right back to a
    // single leading "@" here, so from the user's perspective it never actually goes away.
    const raw = e.target.value.replace(/^@+/, "");
    setUsernameInput("@" + raw);
  }
  // The "@" is permanent, so the cursor/selection is never allowed to land in front of it — every
  // click, keyboard nav (Home, arrow-left, etc.), or selection change that would put either edge
  // at position 0 gets nudged to position 1 (right after the "@") instead.
  function handleUsernameSelect(e) {
    const el = e.target;
    if (!el.value) return;
    const start = Math.max(1, el.selectionStart);
    const end = Math.max(1, el.selectionEnd);
    if (start !== el.selectionStart || end !== el.selectionEnd) el.setSelectionRange(start, end);
  }

  const config = { age, bodyType, skinColor, parts };

  // JSON.stringify as the dependency key sidesteps manually listing every nested field of
  // `parts` — a plain, valid way to react to deep changes in a moderately-sized config object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const redraw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    for (const layer of buildLayerList(config)) {
      try {
        const img = await loadImage(layer.src);
        if (layer.color) drawRecolored(ctx, img, layer.color, CANVAS_SIZE);
        else ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE); // fixed mouth/eyes/nose — no tint
      } catch {
        // Asset not present (e.g. public/assets/avatar/build/ not populated yet) — skip that
        // layer rather than breaking the whole preview.
      }
    }
  }, [JSON.stringify(config)]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  function setPart(key, patch) {
    setParts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function selectSkinPreset(i) {
    setSkinColor(SKIN_COLORS[i]);
    setSkinSliderT(hueToT(hexHue(SKIN_COLORS[i])));
  }
  function handleSkinSlider(t) {
    setSkinSliderT(t);
    setSkinColor(interpolateStops(RAINBOW_STOPS, t));
  }

  function handleRandom() {
    setAge(randomChoice(AGES));
    setBodyType(randomChoice(TYPES));
    const t = Math.random();
    setSkinSliderT(t);
    setSkinColor(interpolateStops(RAINBOW_STOPS, t));
    setParts(
      Object.fromEntries(
        CATEGORIES.map((c) => {
          const option = Math.floor(Math.random() * (c.count + 1)); // 0 (none) .. count
          return [c.key, { option, colorT: Math.random() }];
        })
      )
    );
  }

  async function handleSave() {
    setError("");
    if (!usernameStatus.ok) {
      setError("Pick a username before continuing.");
      return;
    }
    setSaving(true);
    try {
      const canvas = canvasRef.current;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Couldn't render the avatar image.");

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const path = `${user.id}/avatar.png`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/png" });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      // Cache-busting query param — the storage path is deterministic/reused on every save, so
      // without this the browser (or a CDN) could keep serving a stale cached image.
      const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ username, display_name: username, avatar_url: avatarUrl, avatar_config: config })
        .eq("id", user.id);
      if (updateError) throw updateError;

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err.message || "Something went wrong saving your avatar.");
      setSaving(false);
    }
  }

  return (
    <div className="avatar-setup-shell">
      <div className="avatar-setup-card">
        <div className="avatar-setup-options">
          <div className="avatar-setup-options-inner">
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Create your character</h1>

          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder="@username"
              autoComplete="username"
              value={usernameInput}
              onChange={handleUsernameChange}
              onFocus={handleUsernameFocus}
              onBlur={handleUsernameBlur}
              onSelect={handleUsernameSelect}
              onClick={handleUsernameSelect}
              style={{
                width: "100%",
                background: "#1a1a1a",
                border: "1px solid var(--card-border)",
                borderRadius: 8,
                color: "var(--ink)",
                padding: "10px 34px 10px 12px",
                fontSize: 13,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <ValidityDot
              show={!!usernameInput && (usernameFocused || usernameSettled)}
              pending={!usernameSettled}
              ok={usernameStatus.ok}
              reason={usernameStatus.reason}
            />
          </div>

          <div>
            <div className="avatar-setup-section-label">Skin tone</div>
            <div className="avatar-setup-skintone-row">
              <div className="avatar-setup-skintone-presets">
                {SKIN_COLORS.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    className={`avatar-setup-swatch ${skinColor === c ? "selected" : ""}`}
                    style={{ background: c }}
                    onClick={() => selectSkinPreset(i)}
                    title={c}
                  />
                ))}
              </div>
              <ColorGradientSlider stops={RAINBOW_STOPS} t={skinSliderT} onChange={handleSkinSlider} />
            </div>
          </div>

          {PAIR_ROWS.map((pairKeys) => (
            <div className="avatar-setup-pair-row" key={pairKeys.join("-")}>
              {pairKeys.map((key) => {
                const cat = CATEGORIES.find((c) => c.key === key);
                return (
                  <div className="avatar-setup-pair-col" key={cat.key}>
                    <div className="avatar-setup-section-label">{cat.label}</div>
                    <div className="avatar-setup-option-grid">
                      {Array.from({ length: cat.count }, (_, i) => i + 1).map((n) => {
                        const selected = parts[cat.key].option === n;
                        return (
                          <button
                            key={n}
                            type="button"
                            className={`avatar-setup-option-btn ${selected ? "selected" : ""}`}
                            // Clicking the already-selected option again toggles it off (option:
                            // 0, i.e. "none") instead of a separate None button.
                            onClick={() => setPart(cat.key, { option: selected ? 0 : n })}
                          >
                            <img
                              src={`${ASSET_BASE}/${cat.key}-${n}.png`}
                              alt=""
                              onError={(e) => {
                                e.target.style.visibility = "hidden";
                              }}
                            />
                          </button>
                        );
                      })}
                    </div>
                    <ColorGradientSlider
                      stops={RAINBOW_STOPS}
                      t={parts[cat.key].colorT}
                      onChange={(t) => setPart(cat.key, { colorT: t })}
                    />
                  </div>
                );
              })}
            </div>
          ))}
          </div>
        </div>

        <div className="avatar-setup-preview-col">
          <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} className="avatar-setup-preview-canvas" />
          <div>
            <div className="avatar-setup-section-label">Age</div>
            <StopSlider stops={AGES} labels={AGE_LABELS} value={age} onChange={setAge} />
          </div>
          <div>
            <div className="avatar-setup-section-label">Build</div>
            <StopSlider stops={TYPES} labels={TYPE_LABELS} value={bodyType} onChange={setBodyType} />
          </div>

          {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}

          <div className="avatar-setup-action-row">
            <button type="button" className="avatar-setup-random-btn" disabled={saving} onClick={handleRandom}>
              Random
            </button>
            <button type="button" className="avatar-setup-save-btn" disabled={saving || !usernameStatus.ok} onClick={handleSave}>
              {saving ? "Saving…" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
