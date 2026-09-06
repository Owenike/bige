import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BIG E 主管驗證",
    short_name: "BIG E 驗證",
    description: "BIG E 主管手機登入核准",
    start_url: "/staff/supervisor-device",
    display: "standalone",
    background_color: "#05070a",
    theme_color: "#05070a",
    icons: [
      {
        src: "/LOGO-transparent.png",
        sizes: "any",
        type: "image/png",
      },
    ],
  };
}
