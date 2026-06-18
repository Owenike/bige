import type { MetadataRoute } from "next";

const siteUrl = "https://bigefitness.com";

const publicRoutes = [
  "/",
  "/faq",
  "/trial-booking",
  "/renwu-pilates",
  "/training/pilates",
  "/training/weight-training",
  "/training/boxing",
  "/training/functional-adjustment",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: `${siteUrl}${route}`,
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
