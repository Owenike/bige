import { getImageProps } from "next/image";
import styles from "./login-portal.module.css";

const staffLoginImageCommon = {
  alt: "",
  fetchPriority: "high" as const,
  sizes: "100vw",
};

const {
  props: { srcSet: staffLoginDesktopSrcSet },
} = getImageProps({
  ...staffLoginImageCommon,
  src: "/home-images/home-hero-main.png",
  width: 1672,
  height: 941,
  quality: 82,
});

const {
  props: { srcSet: staffLoginMobileSrcSet, ...staffLoginMobileImageProps },
} = getImageProps({
  ...staffLoginImageCommon,
  src: "/home-images/home-hero-main-mobile.png",
  width: 941,
  height: 1672,
  quality: 78,
});

export default function StaffAuthBackdrop() {
  return (
    <div className={styles.staffLoginBackdrop} aria-hidden="true">
      <picture className={styles.staffLoginPicture}>
        <source media="(min-width: 721px)" srcSet={staffLoginDesktopSrcSet} />
        <source media="(max-width: 720px)" srcSet={staffLoginMobileSrcSet} />
        <img {...staffLoginMobileImageProps} alt="" className={styles.staffLoginImage} />
      </picture>
      <div className={styles.staffLoginShade} />
    </div>
  );
}
