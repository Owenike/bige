# Homepage Image Placement Guide

Place approved homepage replacement images in this folder before the formal image replacement round.

Project scope:

- Route `/` homepage only
- Do not use this folder for `/booking` storefront images

## File naming rules

Homepage logo:

- `logo-main.jpg`

Homepage full-width images:

- `hero-main.webp`
- `section-body-awareness.webp`
- `section-platform-message.webp`

Homepage showcase `S2` cards:

- `card-pilates-showcase.webp`
- `card-weight-training-showcase.webp`
- `card-boxing-showcase.webp`
- `card-massage-showcase.webp`

Homepage training `S4` cards:

- `card-senior-training.png`
- `card-cardio-training.png`
- `card-core-training.webp`
- `card-functional-training.webp`

Homepage choices `S6` cards:

- `card-single-pass.webp`
- `card-membership.webp`
- `card-coaching.webp`
- `card-assessment.webp`

Homepage CTA `S8` cards:

- `card-contact.webp`
- `card-book-now.webp`
- `card-map-guide.webp`

## Recommended ratios and sizes

- `logo-main.jpg`: `1:1`
- `hero-main.webp` or `hero-main.jpg`: `16:9` to `21:9`, recommended width `2200px` or above
- `section-body-awareness.webp` or `section-body-awareness.jpg`: `16:9`, recommended width `2200px` or above
- `section-platform-message.webp`: `16:9`, recommended width `2200px` or above
- `S2` cards: `16:10`
- `S4` / `S6` / `S8` cards: `4:5`

## Notes for the next round

- Keep the approved file extension when the source asset is not WEBP or JPG unless the replacement plan explicitly says otherwise.
- The next implementation round should only update homepage image references after these files are in place.
- The next implementation round should update `app/globals.css` `--home-image-*` variables and `app/page.tsx` logo path.
- Hero main visual currently uses: `hero-main.jpg`
- Body awareness full-width background currently uses: `section-body-awareness.jpg`
- Showcase S2A "Pilates" cover currently uses: `card-pilates-showcase-cover.jpg`
- Showcase S2B "Weight Training" cover currently uses: `card-weight-training-showcase-cover.jpg`
- Showcase S2C "Boxing" cover currently uses: `card-boxing-showcase-cover.jpg`
- Showcase S2D "Massage" cover currently uses: `card-massage-showcase-cover.jpg`
- Training S4A "Weight Training" currently uses: `card-weight-training.png`
- Training S4B "Boxing Conditioning Training" currently uses: `card-boxing-training.png`
- Training S4C "Pilates Core Training" currently uses: `card-pilates-core.png`
- Training S4D "Functional Adjustment" currently uses: `card-functional-training.png`
- Choices S6A "Single Pass" currently uses: `card-single-pass.jpg`
- Choices S6B "Membership" currently uses: `card-membership.jpg`
- Choices S6C "Coaching" currently uses: `card-coaching.jpg`
- Choices S6D "Assessment" currently uses: `card-assessment.jpg`
- The four `S2` cover images are the fallback / cover images shown before each MP4 starts playing.
- Recommended ratio for `S2` cover images: `16:10`
- Recommended size for `S2` cover images: `1600x1000` or `2400x1500`
- Recommended ratio for `S4` training images: `4:5`
- Recommended size for `S4` training images: `1600x2000`
- If the provided file is `JPG`, use the `JPG` path directly and do not rename the reference to `WEBP`.
- Only use a `.webp` filename when the asset has actually been converted to `WEBP`.
