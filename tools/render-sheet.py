#!/usr/bin/env python3
"""Drape a cloth sheet for the elimination scorecard.

Headless mass-spring relaxation over a sculpted drape. No stock photos and
no third-party meshes. Re-render from the repo root:

    python3 tools/render-sheet.py

Writes:
    apps/web/public/shot/sheet.png
    apps/web/public/shot/sheet.webp
    apps/web/public/shot/sheet-map.png

If Demetrius's police RIP is mounted, also writes a 3x WebP/PNG of it,
pre-warped by this sheet's luminance so the letters follow the folds:

    /cursor/stores/bot/refs/rip-colorful-a-police.png
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "apps" / "web" / "public" / "shot"
RIP_SRC = Path("/cursor/stores/bot/refs/rip-colorful-a-police.png")

# 4x of the phone shroud (about 370×173 CSS, including the hem). Wider than tall,
# matching the scorecard, so the drape is not squashed when it fills the card.
OUT_W, OUT_H = 1480, 692
NX, NY = 185, 86
CLOTH = np.array([0xEE, 0xF0, 0xF3], dtype=np.float64)

# Card plateau, as a fraction of the sheet. The hem lives below y1.
X0, X1, Y0, Y1 = 0.055, 0.945, 0.012, 0.90


def coords(nx: int, ny: int) -> tuple[np.ndarray, np.ndarray]:
    ys = np.linspace(0, 1, ny)[:, None]
    xs = np.linspace(0, 1, nx)[None, :]
    return xs, ys


def card_distance(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    dx = np.maximum(np.maximum(X0 - xs, xs - X1), 0)
    dy = np.maximum(np.maximum(Y0 - ys, ys - Y1), 0)
    return np.hypot(dx, dy)


def hem_bottom(xs: np.ndarray) -> np.ndarray:
    """Irregular hanging edge: a few deep drips, corners pulled up off the card."""
    t = xs.reshape(-1)
    hang = np.zeros_like(t)
    for center, width, depth in (
        (0.16, 0.045, 0.035),
        (0.34, 0.07, 0.078),
        (0.52, 0.04, 0.045),
        (0.70, 0.08, 0.09),
        (0.86, 0.035, 0.028),
    ):
        hang += depth * np.exp(-((t - center) ** 2) / (2 * width * width))
    edge = np.clip((t - 0.05) / 0.05, 0, 1) * np.clip((0.95 - t) / 0.05, 0, 1)
    # Corners sit above the card's bottom edge so the scorecard pokes through.
    return Y1 - 0.018 + hang * edge - 0.055 * (1 - edge)


def build_mask(nx: int, ny: int) -> np.ndarray:
    xs, ys = coords(nx, ny)
    side = 0.028 + 0.008 * np.sin(ys * 18) 
    # Tuck the sides in toward the hem so the card's lower corners stay bare.
    tuck = np.clip((ys - (Y1 - 0.06)) / 0.14, 0, 1)
    side = side * (1 - 0.85 * tuck)
    left = X0 - side
    right = X1 + side
    bottom = hem_bottom(xs)[None, :]
    return (xs >= left) & (xs <= right) & (ys >= Y0 - 0.008) & (ys <= bottom)


def seed_height(nx: int, ny: int) -> np.ndarray:
    xs, ys = coords(nx, ny)
    dist = card_distance(xs, ys)
    # The card holds the cloth up. Off the edges it falls.
    z = 1.35 - 3.1 * np.sqrt(dist) - 6.5 * dist
    # A broad lip where the cloth crests the card edge, so the rectangle reads as a bump.
    z += 0.48 * np.exp(-(dist * dist) / (2 * 0.028 ** 2))
    for cx, cy, amp in (
        (X0, Y0, 0.35),
        (X1, Y0, 0.28),
        (X0, Y1, 0.7),
        (X1, Y1, 0.62),
    ):
        z += amp * np.exp(-(((xs - cx) ** 2) + ((ys - cy) ** 2)) / (2 * 0.04 ** 2))

    def valley(x_at_0: float, slope: float, width: float, depth: float) -> np.ndarray:
        d = (ys - x_at_0) - slope * xs
        return depth * np.exp(-(d * d) / (2 * width * width))

    # Three broad diagonal creases. Wide enough to read on a phone card, with a
    # raised shoulder beside the deepest one.
    z -= valley(-0.02, 0.85, 0.045, 1.7)
    z += valley(0.06, 0.85, 0.07, 0.45)
    z -= valley(0.34, 0.72, 0.032, 1.15)
    z -= valley(0.62, 1.05, 0.04, 0.85)
    return z


def relax(z: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Pull slack cloth downward off the card. The plateau is a hard floor."""
    xs, ys = coords(z.shape[1], z.shape[0])
    dist = card_distance(xs, ys)
    inside = (dist <= 0) & mask
    pinned = np.zeros(z.shape, dtype=bool)
    pinned[0, :] = True
    pin_z = z[0].copy()
    prev = z.copy()
    # A little slack, not enough to spike a grid-scale zigzag. The broad
    # diagonal valleys are already in the seed; this pass just lets the hem sag.
    rh = np.full((z.shape[0], z.shape[1] - 1), 1.015)
    rv = np.full((z.shape[0] - 1, z.shape[1]), 1.012)

    def push(field: np.ndarray, axis: int, rest: np.ndarray) -> None:
        if axis == 1:
            a = field[:, :-1]
            b = field[:, 1:]
        else:
            a = field[:-1, :]
            b = field[1:, :]
        dz = b - a
        dist_e = np.sqrt(1.0 + dz * dz)
        sign = np.where(np.abs(dz) < 1e-4, 1.0, np.sign(dz))
        target = sign * np.sqrt(np.maximum(rest * rest - 1.0, 0.0))
        corr = np.where(dist_e < rest, (target - dz) * 0.35, 0.0)
        if axis == 1:
            field[:, :-1] -= corr
            field[:, 1:] += corr
        else:
            field[:-1, :] -= corr
            field[1:, :] += corr

    for _ in range(36):
        vel = (z - prev) * 0.86
        prev = z.copy()
        z = z + vel
        z += np.where(inside, -0.004, -0.05)
        for _it in range(4):
            push(z, 1, rh)
            push(z, 0, rv)
            z = np.where(inside, np.maximum(z, 0.85), z)
            z = np.where(pinned, pin_z, z)
            z = np.clip(z, -4.8, 3.4)
    # Knock out grid-scale chatter so the creases stay broad.
    z = blur_axis(z, 1.4)
    z = np.where(mask, z, z)
    return z


def blur_axis(src: np.ndarray, radius: float) -> np.ndarray:
    span = max(1, int(radius * 3))
    kx = np.arange(-span, span + 1, dtype=np.float64)
    kernel = np.exp(-(kx * kx) / (2 * radius * radius))
    kernel /= kernel.sum()
    out = np.apply_along_axis(lambda row: np.convolve(row, kernel, mode="same"), 1, src)
    return np.apply_along_axis(lambda col: np.convolve(col, kernel, mode="same"), 0, out)


def render(z: np.ndarray, mask: np.ndarray) -> tuple[Image.Image, Image.Image]:
    z_img = Image.fromarray(z.astype(np.float32), mode="F").resize((OUT_W, OUT_H), Image.Resampling.BICUBIC)
    m_img = Image.fromarray((mask.astype(np.uint8) * 255), mode="L").resize((OUT_W, OUT_H), Image.Resampling.BICUBIC)
    height = np.asarray(z_img, dtype=np.float64)
    alpha = np.clip((np.asarray(m_img, dtype=np.float64) / 255.0 - 0.42) / 0.35, 0, 1)

    gy, gx = np.gradient(height)
    normal = np.stack([-gx * 1.35, -gy * 1.35, np.ones_like(height)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True).clip(min=1e-6)
    key = np.array([-0.48, -0.58, 0.66])
    key /= np.linalg.norm(key)
    ndotl = np.clip(normal @ key, 0, 1)
    # Most of the cloth stays near #EEF0F3. Only the crease hollows drop dark.
    ridge = blur_axis(height, 22)
    relief = np.clip((ridge - height) / 0.42, 0, 1) ** 0.72
    peak = np.clip((height - ridge) / 0.28, 0, 1)
    # White cloth, with a dark slot in each crease and a bright shoulder beside it.
    shade = (0.9 + 0.16 * ndotl) * (1 - 0.86 * relief) + 0.16 * peak
    shade = np.clip(shade, 0.16, 1.08)

    yy, xx = np.mgrid[0:OUT_H, 0:OUT_W]
    period = 3.2  # fine plain weave, still a couple of threads per CSS pixel at 2x
    warp = np.sin(xx * (2 * np.pi / period))
    weft = np.sin(yy * (2 * np.pi / period))
    basket = ((np.floor(xx / period) + np.floor(yy / period)).astype(np.int32) & 1).astype(np.float64)
    thread = np.where(basket > 0, warp, weft)
    fiber = 1.0 + 0.09 * thread
    spec = np.clip(thread, 0, 1) ** 3 * (ndotl ** 3) * 0.14

    # Hollows lean a little bluer so the cloth stays cool instead of turning gray-brown.
    tint = np.array([0.86, 0.91, 1.08])
    cool = 1 + (tint - 1) * relief[..., None]
    rgb = CLOTH * shade[..., None] * fiber[..., None] * cool
    rgb += spec[..., None] * 255
    rgb = np.clip(rgb, 0, 255)

    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    cloth = Image.fromarray(rgba, mode="RGBA")
    lum = np.clip((height - np.percentile(height, 2)) / (np.percentile(height, 98) - np.percentile(height, 2) + 1e-6), 0, 1)
    lum_img = Image.fromarray((lum * alpha * 255).astype(np.uint8), mode="L")
    return cloth, lum_img


def optimize_rip(sheet_lum: Image.Image) -> None:
    if not RIP_SRC.is_file():
        print(f"police RIP not mounted at {RIP_SRC}; sheet only")
        return
    src = Image.open(RIP_SRC).convert("RGBA")
    bbox = src.getbbox()
    if bbox:
        src = src.crop(bbox)
    # At most 3x of the on-sheet size (~300 CSS px wide).
    max_w = 900
    if src.width > max_w:
        h = round(src.height * max_w / src.width)
        src = src.resize((max_w, h), Image.Resampling.LANCZOS)
    lum = sheet_lum.resize(src.size, Image.Resampling.BICUBIC)
    field = np.asarray(lum, dtype=np.float64) / 255.0 - 0.45
    arr = np.asarray(src)
    yy, xx = np.mgrid[0:src.height, 0:src.width]
    sx = np.clip(xx + field * 12, 0, src.width - 1)
    sy = np.clip(yy + field * 8, 0, src.height - 1)
    x0 = np.floor(sx).astype(np.int32)
    y0 = np.floor(sy).astype(np.int32)
    x1 = np.clip(x0 + 1, 0, src.width - 1)
    y1 = np.clip(y0 + 1, 0, src.height - 1)
    fx = (sx - x0)[..., None]
    fy = (sy - y0)[..., None]
    warped = (
        arr[y0, x0] * (1 - fx) * (1 - fy)
        + arr[y0, x1] * fx * (1 - fy)
        + arr[y1, x0] * (1 - fx) * fy
        + arr[y1, x1] * fx * fy
    )
    out = Image.fromarray(warped.astype(np.uint8), mode="RGBA")
    out.save(OUT_DIR / "rip.png", optimize=True)
    out.save(OUT_DIR / "rip.webp", "WEBP", quality=78, method=6)
    print("rip", out.size, (OUT_DIR / "rip.webp").stat().st_size)


def main() -> None:
    mask = build_mask(NX, NY)
    z = relax(seed_height(NX, NY), mask)
    cloth, lum = render(z, mask)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cloth.save(OUT_DIR / "sheet.png", optimize=True)
    cloth.save(OUT_DIR / "sheet.webp", "WEBP", quality=78, method=6)
    lum.save(OUT_DIR / "sheet-map.png", optimize=True)
    print(
        "sheet",
        cloth.size,
        "png",
        (OUT_DIR / "sheet.png").stat().st_size,
        "webp",
        (OUT_DIR / "sheet.webp").stat().st_size,
    )
    optimize_rip(lum)


if __name__ == "__main__":
    main()
