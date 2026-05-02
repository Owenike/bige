# Homepage Video Placement Guide

This folder stores homepage background video assets.

Project scope:

- Route `/` homepage only
- Do not use this folder for `/booking` storefront media

## Currently active videos

- `card-pilates-showcase.mp4`: Showcase S2A "器械皮拉提斯"
- `card-weight-training-showcase.mp4`: Showcase S2B "重量訓練"
- `card-boxing-showcase.mp4`: Showcase S2C "拳擊訓練"
- `card-massage-showcase.mp4`: Showcase S2D "運動按摩"

## Notes

- Homepage background videos should use `MP4`
- Keep videos short, lightweight, and suitable for silent autoplay
- The frontend uses `muted + autoPlay + loop + playsInline`
- Do not just rename the extension; if the source is not `MP4`, convert it properly before use
- Keep the existing CSS background images in place as fallback for the Showcase S2 cards
