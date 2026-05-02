# Homepage Image Replacement Map

This document covers the homepage route `/` only.

- Project: `bige`
- Scope in this round: homepage logo and homepage background images
- Explicitly out of scope: `/booking` Supabase Storage storefront images and their upload flow

## Current homepage image overview

| Homepage section | Current image source | Reference file / class | Live on homepage | Replace next round | Recommended ratio | Recommended minimum size | Recommended new filename |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Brand logo | `/LOGO.jpg` | `app/page.tsx` `Image src="/LOGO.jpg"` | Yes | Yes | `1:1` | `1024x1024` | `logo-main.jpg` |
| Hero main visual | External Unsplash URL | `app/globals.css` `.homeLuxuryHeroImage` via `--home-image-hero-main` | Yes | Yes | `16:9` to `21:9` | `2200x1400` | `hero-main.webp` |
| Full-width background section A | External Unsplash URL | `app/globals.css` `.homeLuxurySectionImageA` via `--home-image-section-a` | Yes | Yes | `16:9` | `2200x1400` | `section-body-awareness.webp` |
| Full-width background section B | External Unsplash URL | `app/globals.css` `.homeLuxurySectionImageB` via `--home-image-section-b` | Yes | Yes | `16:9` | `2200x1400` | `section-platform-message.webp` |
| Showcase card S2A | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS2A` + `app/globals.css` `--home-image-card-s2-a` | Yes | Yes | `16:10` | `1600x1000` | `card-pilates-showcase.webp` |
| Showcase card S2B | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS2B` + `app/globals.css` `--home-image-card-s2-b` | Yes | Yes | `16:10` | `1600x1000` | `card-weight-training-showcase.webp` |
| Showcase card S2C | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS2C` + `app/globals.css` `--home-image-card-s2-c` | Yes | Yes | `16:10` | `1600x1000` | `card-boxing-showcase.webp` |
| Showcase card S2D | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS2D` + `app/globals.css` `--home-image-card-s2-d` | Yes | Yes | `16:10` | `1600x1000` | `card-massage-showcase.webp` |
| Training card S4A | `/Senior.png` | `app/page.tsx` `homeLuxuryMediaS4A` + `app/globals.css` `--home-image-card-s4-a` | Yes | Yes | `4:5` | `1600x2000` | `card-senior-training.png` |
| Training card S4B | `/Cardio.png` | `app/page.tsx` `homeLuxuryMediaS4B` + `app/globals.css` `--home-image-card-s4-b` | Yes | Yes | `4:5` | `1600x2000` | `card-cardio-training.png` |
| Training card S4C | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS4C` + `app/globals.css` `--home-image-card-s4-c` | Yes | Yes | `4:5` | `1600x2000` | `card-core-training.webp` |
| Training card S4D | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS4D` + `app/globals.css` `--home-image-card-s4-d` | Yes | Yes | `4:5` | `1600x2000` | `card-functional-training.webp` |
| Choices card S6A | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS6A` + `app/globals.css` `--home-image-card-s6-a` | Yes | Yes | `4:5` | `1600x2000` | `card-single-pass.webp` |
| Choices card S6B | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS6B` + `app/globals.css` `--home-image-card-s6-b` | Yes | Yes | `4:5` | `1600x2000` | `card-membership.webp` |
| Choices card S6C | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS6C` + `app/globals.css` `--home-image-card-s6-c` | Yes | Yes | `4:5` | `1600x2000` | `card-coaching.webp` |
| Choices card S6D | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS6D` + `app/globals.css` `--home-image-card-s6-d` | Yes | Yes | `4:5` | `1600x2000` | `card-assessment.webp` |
| CTA card S8A | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS8A` + `app/globals.css` `--home-image-card-s8-a` | Yes | Yes | `4:5` | `1600x2000` | `card-contact.webp` |
| CTA card S8B | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS8B` + `app/globals.css` `--home-image-card-s8-b` | Yes | Yes | `4:5` | `1600x2000` | `card-book-now.webp` |
| CTA card S8C | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS8C` + `app/globals.css` `--home-image-card-s8-c` | Yes | Yes | `4:5` | `1600x2000` | `card-map-guide.webp` |

## Centralized replacement entrypoints

Homepage background image URLs are now centralized in `app/globals.css` under the `:root` block.

- `--home-image-hero-main`
- `--home-image-section-a`
- `--home-image-section-b`
- `--home-image-card-s2-a` to `--home-image-card-s2-d`
- `--home-image-card-s4-a` to `--home-image-card-s4-d`
- `--home-image-card-s6-a` to `--home-image-card-s6-d`
- `--home-image-card-s8-a` to `--home-image-card-s8-c`

If the next round includes actual replacement, update those variables first instead of searching for each `url(...)` across the file.

## Logo replacement entrypoint

The homepage logo is referenced directly in:

- `app/page.tsx`

Current source:

- `/LOGO.jpg`

If a new logo is provided, keep it in `public/home-images/` and update the `Image` source in `app/page.tsx`.

## Where to place new images next round

If new homepage assets are provided in a future round, place them here:

- `public/home-images/`

Suggested file set:

- `public/home-images/logo-main.jpg`
- `public/home-images/hero-main.webp`
- `public/home-images/section-body-awareness.webp`
- `public/home-images/section-platform-message.webp`
- `public/home-images/card-pilates-showcase.webp`
- `public/home-images/card-weight-training-showcase.webp`
- `public/home-images/card-boxing-showcase.webp`
- `public/home-images/card-massage-showcase.webp`
- `public/home-images/card-senior-training.png`
- `public/home-images/card-cardio-training.png`
- `public/home-images/card-core-training.webp`
- `public/home-images/card-functional-training.webp`
- `public/home-images/card-single-pass.webp`
- `public/home-images/card-membership.webp`
- `public/home-images/card-coaching.webp`
- `public/home-images/card-assessment.webp`
- `public/home-images/card-contact.webp`
- `public/home-images/card-book-now.webp`
- `public/home-images/card-map-guide.webp`

This folder was not created in this round because no confirmed new assets were found.

## Images found in `public/` that are not currently used on homepage

These files exist in `public/` but were not found in active homepage references:

| File | Current status | Notes |
| --- | --- | --- |
| `public/body-awareness.png` | Not used | Potentially useful for future homepage section image, but not wired up now |
| `public/contact-us.png` | Not used | Potentially useful for CTA replacement, but not wired up now |
| `public/drop-in.png` | Not used | Potentially useful for membership / entry card, but not wired up now |
| `public/map-directions.png` | Not used | Potentially useful for CTA map card, but not wired up now |
| `public/frontdesk-glass-bg.svg` | Not used on homepage | Frontdesk-related asset, leave untouched in homepage image work |

## Existing local images already live on homepage

| File | Current homepage usage |
| --- | --- |
| `public/LOGO.jpg` | Homepage brand logo |
| `public/Senior.png` | Training card `S4A` background |
| `public/Cardio.png` | Training card `S4B` background |

## `/booking` images excluded in this round

Do not change these in homepage-only image work:

- `app/booking/page.tsx`
- `components/booking-hero.tsx`
- `app/manager/settings/brand/page.tsx`
- `app/api/manager/storefront/upload/route.ts`
- `lib/storefront.ts`
- `lib/storage/storefront-assets.ts`

Reason:

- `/booking` hero images come from Supabase Storage and storefront brand content fields such as `heroImageUrl` and `mobileFeatureImageUrl`
- Those assets are part of the booking storefront flow, not the homepage `/`

## New asset scan result for this round

Scanned locations:

- `public/`
- `public/home/`
- `public/images/`
- `public/site/`
- `public/brand/`
- `public/replace/`

Result:

- `public/home/`, `public/images/`, `public/site/`, `public/brand/`, and `public/replace/` do not exist
- No clearly named new homepage replacement set was found
- Only the existing root-level `public/` images were found

## Safe replacement workflow for the next round

1. Put approved homepage images into `public/home-images/`
2. Replace the logo path in `app/page.tsx` if a new logo is provided
3. Replace the `--home-image-*` variables in `app/globals.css`
4. Run `npm run lint`
5. Run `npm run typecheck`
6. Run `npm run build`
7. Verify desktop and mobile cropping on the live-style homepage sections
