import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/admin/", "/api", "/api/", "/store", "/store/", "/login", "/acpay-test", "/*test*"],
    },
    sitemap: "https://bigefitness.com/sitemap.xml",
  };
}
