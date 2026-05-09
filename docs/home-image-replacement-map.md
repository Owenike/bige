# Homepage Image Replacement Map

This document covers the homepage route `/` only.

- Project: `bige`
- Scope in this round: homepage logo, homepage background images, and homepage showcase background videos
- Explicitly out of scope: `/booking` Supabase Storage storefront images and their upload flow

## Current homepage image overview

| Homepage section | Current image source | Reference file / class | Live on homepage | Replace next round | Recommended ratio | Recommended minimum size | Recommended new filename |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Brand logo | `/LOGO.jpg` | `app/page.tsx` `Image src="/LOGO.jpg"` | Yes | Yes | `1:1` | `1024x1024` | `logo-main.jpg` |
| Hero main visual | `/home-images/hero-main.jpg` | `app/globals.css` `.homeLuxuryHeroImage` via `--home-image-hero-main` | Yes | Yes | `16:9` to `21:9` | `2200x1400` | `hero-main.jpg` |
| Full-width background section A | `/home-images/section-body-awareness.jpg` | `app/globals.css` `.homeLuxurySectionImageA` via `--home-image-section-a` | Yes | Yes | `16:9` | `2200x1400` | `section-body-awareness.jpg` |
| Full-width background section B | External Unsplash URL | `app/globals.css` `.homeLuxurySectionImageB` via `--home-image-section-b` | Yes | Yes | `16:9` | `2200x1400` | `section-platform-message.webp` |
| Showcase card S2A | `/home-videos/card-pilates-showcase.mp4` with fallback image variable `--home-image-card-s2-a` | `app/page.tsx` `homeLuxuryMediaS2A` + `app/globals.css` `--home-image-card-s2-a` | Yes | Yes | `16:10` | `1600x1000` | `card-pilates-showcase.mp4` |
| Showcase card S2B | `/home-videos/card-weight-training-showcase.mp4` with fallback image variable `--home-image-card-s2-b` | `app/page.tsx` `homeLuxuryMediaS2B` + `app/globals.css` `--home-image-card-s2-b` | Yes | Yes | `16:10` | `1600x1000` | `card-weight-training-showcase.mp4` |
| Showcase card S2C | `/home-videos/card-boxing-showcase.mp4` with fallback image variable `--home-image-card-s2-c` | `app/page.tsx` `homeLuxuryMediaS2C` + `app/globals.css` `--home-image-card-s2-c` | Yes | Yes | `16:10` | `1600x1000` | `card-boxing-showcase.mp4` |
| Showcase card S2D | `/home-videos/card-massage-showcase.mp4` with fallback image variable `--home-image-card-s2-d` | `app/page.tsx` `homeLuxuryMediaS2D` + `app/globals.css` `--home-image-card-s2-d` | Yes | Yes | `16:10` | `1600x1000` | `card-massage-showcase.mp4` |
| Training card S4A | `/Senior.png` | `app/page.tsx` `homeLuxuryMediaS4A` + `app/globals.css` `--home-image-card-s4-a` | Yes | Yes | `4:5` | `1600x2000` | `card-senior-training.png` |
| Training card S4B | `/Cardio.png` | `app/page.tsx` `homeLuxuryMediaS4B` + `app/globals.css` `--home-image-card-s4-b` | Yes | Yes | `4:5` | `1600x2000` | `card-cardio-training.png` |
| Training card S4C | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS4C` + `app/globals.css` `--home-image-card-s4-c` | Yes | Yes | `4:5` | `1600x2000` | `card-core-training.webp` |
| Training card S4D | External Unsplash URL | `app/page.tsx` `homeLuxuryMediaS4D` + `app/globals.css` `--home-image-card-s4-d` | Yes | Yes | `4:5` | `1600x2000` | `card-functional-training.webp` |
| Choices card S6A | `/home-images/card-single-pass.jpg` | `app/page.tsx` `homeLuxuryMediaS6A` + `app/globals.css` `--home-image-card-s6-a` | Yes | Yes | `4:5` | `1600x2000` | `card-single-pass.jpg` |
| Choices card S6B | `/home-images/card-membership.jpg` | `app/page.tsx` `homeLuxuryMediaS6B` + `app/globals.css` `--home-image-card-s6-b` | Yes | Yes | `4:5` | `1600x2000` | `card-membership.jpg` |
| Choices card S6C | `/home-images/card-coaching.jpg` | `app/page.tsx` `homeLuxuryMediaS6C` + `app/globals.css` `--home-image-card-s6-c` | Yes | Yes | `4:5` | `1600x2000` | `card-coaching.jpg` |
| Choices card S6D | `/home-images/card-assessment.jpg` | `app/page.tsx` `homeLuxuryMediaS6D` + `app/globals.css` `--home-image-card-s6-d` | Yes | Yes | `4:5` | `1600x2000` | `card-assessment.jpg` |
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

Before the formal homepage image replacement round, place the approved new images in `public/home-images/` and name them according to `public/home-images/README.md`. This round has already switched the homepage hero visual to `hero-main.jpg` and the body awareness background to `section-body-awareness.jpg`. A future round can continue updating the remaining `--home-image-*` variables and the logo path in `app/page.tsx`.

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

This folder is now in use for homepage JPG assets.

## Replacement progress in this round

Completed in this round:

- `hero-main.jpg` now replaces the homepage hero main visual
- `section-body-awareness.jpg` now replaces the homepage "Body Awareness" full-width background
- Both active replacements use `JPG`, not `WEBP`

Still unchanged:

- All other homepage images still use their previous sources, except the Choices S6 cards updated below
- Logo is still `/LOGO.jpg`
- `/booking` storefront brand images are still out of scope

Completed in this round for Choices S6:

- `card-single-pass.jpg` now replaces Choices S6A "Single Pass"
- `card-membership.jpg` now replaces Choices S6B "Membership"
- `card-coaching.jpg` now replaces Choices S6C "Coaching"
- `card-assessment.jpg` now replaces Choices S6D "Assessment"
- These 4 active Choices replacements use `JPG`, not `WEBP`
- Other homepage images not listed above still keep their previous sources

Completed in this round for Showcase S2 videos:

- `card-pilates-showcase.mp4` now replaces Showcase S2A "器械皮拉提斯" as the background video
- `card-weight-training-showcase.mp4` now replaces Showcase S2B "重量訓練" as the background video
- `card-boxing-showcase.mp4` now replaces Showcase S2C "拳擊訓練" as the background video
- `card-massage-showcase.mp4` now replaces Showcase S2D "運動按摩" as the background video
- The original S2 background image variables are still kept as fallback
- Other homepage images or videos not listed above still keep their previous sources

Completed in this round for Showcase S2 hover interaction:

- Showcase S2 background videos now play on hover instead of autoplaying on page load
- Hovering a Showcase S2 card plays only that card's video
- Leaving a Showcase S2 card pauses the video and resets it to the beginning
- Hovering a Showcase S2 card now applies a small scale-up effect
- Mobile and non-hover environments do not force the hover scale behavior
- The original S2 background image variables are still kept as fallback

Completed in this round for Showcase S2 hover polish:

- Showcase S2 hover-play videos now fade in and fade out more smoothly
- Hover scale now uses both CSS hover and the `homeLuxuryMediaVideoCardActive` class for more reliable activation
- Leaving the card still pauses the video and resets it to the beginning
- Mobile and non-hover environments still avoid forced hover scale behavior
- The original S2 background image variables are still kept as fallback

Completed in this round for Showcase S2 layout hover behavior:

- Showcase S2 hover behavior now enlarges the active card's layout area while the other three cards shrink slightly
- The video itself no longer scales; it only fades in while playing
- The S2 shared container now uses an active state plus `data-active-card` to adjust grid column and row proportions
- Mobile and non-hover environments do not apply the hover layout resizing
- The original S2 background image variables are still kept as fallback

Completed in this round for Showcase S2 layout smoothing:

- Fixed the S2 hover layout so each card fully stretches to fill its grid cell without leaving black gaps
- S2 videos still do not scale; they now use a `640ms` fade in and fade out only
- Mouse leave now removes the active state first, then pauses and resets the video after the fade-out delay
- The active / inactive grid ratio is now tuned to `1.12 / 0.88`
- Non-active cards now dim to `0.9` brightness instead of becoming overly dark
- Mobile and non-hover environments still do not apply the hover grid animation

Completed in this round for Showcase S2 size restoration:

- The desktop S2 showcase video grid height was increased to `clamp(680px, 88vh, 980px)`
- This restores a larger overall 2x2 showcase footprint closer to the original visual scale
- The hover enlarge / shrink ratio remains `1.12 / 0.88`
- Video playback and `640ms` fade timing remain unchanged
- Mobile and non-hover environments still do not apply the hover grid animation

Completed in this round for Showcase S2 fallback cover images:

- `card-pilates-showcase-cover.jpg` now replaces the Showcase S2A fallback / cover image
- `card-weight-training-showcase-cover.jpg` now replaces the Showcase S2B fallback / cover image
- `card-boxing-showcase-cover.jpg` now replaces the Showcase S2C fallback / cover image
- `card-massage-showcase-cover.jpg` now replaces the Showcase S2D fallback / cover image
- These 4 active fallback covers use `JPG`, not `WEBP`
- The S2 MP4 hover playback logic remains unchanged
- The S2 height and hover enlarge / shrink ratio remain unchanged
- Other homepage images or videos not listed above still keep their previous sources

Completed in this round for Showcase S2 mobile layout:

- Showcase S2 now stacks as single-column horizontal cards on mobile instead of a near-portrait carousel treatment
- Mobile S2 cards keep using the fallback / cover images
- Mobile S2 hides the MP4 layer to avoid hoverless interaction issues
- Desktop S2 still keeps the 2x2 hover video interaction
- Mobile S2 card height now uses an adaptive clamp with large rounded corners and bottom-aligned overlay text

Completed in this round for training card copy updates:

- The first "Training Programs" card changed from "銀髮族訓練" to "重量訓練"
- The second card changed from "心肺體能訓練" to "拳擊體能訓練"
- The third card changed from "核心訓練" to "器械皮拉提斯核心訓練"
- The first three card descriptions were updated to better match BigE gym services
- This round changed text only and did not modify images, videos, layout, or feature logic

Completed in this round for the Pilates training title line break:

- The third "Training Programs" card title is now forced to render as two lines: "器械皮拉提斯" / "核心訓練"
- The third card description remains unchanged
- This round only adjusted text line breaking and did not modify images, videos, layout, or feature logic

Completed in this round for training section image replacement:

- `card-weight-training.png` now replaces the first "Training Programs" card image
- `card-boxing-training.png` now replaces the second "Training Programs" card image
- `card-pilates-core.png` now replaces the third "Training Programs" card image
- `card-functional-training.png` now replaces the fourth "Training Programs" card image
- This round changed image sources only and did not modify text, videos, layout, or feature logic

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

## Training card framing adjustments

- "Weight Training" now uses a tighter crop with `background-size: 121%` and focal point near `50% 47%`
- "Boxing Conditioning Training" now uses `background-size: 117%` with focal point near `54% 43%`
- "Pilates Core Training" now uses `background-size: 113%` with focal point near `52% 46%`
- "Functional Adjustment" remains unchanged this round
- This round only adjusted S4 image framing in `app/globals.css`; no text, layout, hover logic, or video behavior was changed

## CTA image replacements

- `card-contact.png` now replaces the homepage CTA "Contact Us" image
- `card-book-now.png` now replaces the homepage CTA "Book Now" image
- `card-map-guide.png` now replaces the homepage CTA "Map Guide" image
- This round only updated CTA image sources; no CTA copy, links, layout, or logic changed

## Trial booking phase 1

- Added `/trial-booking` as the first-time trial booking form page
- The homepage CTA "Book Now" now points to `/trial-booking`
- This phase includes payment method options for `當天付現` and `線上付款`
- ACPay is not connected in this phase
- LINE notification is not connected in this phase
- Phase 2 recommendation: create an API and storage flow for trial bookings
- Phase 3 recommendation: connect ACPay based on `paymentMethod`
- Phase 4 recommendation: connect LINE notifications after booking and payment flow are stable
