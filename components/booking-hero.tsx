/* eslint-disable @next/next/no-img-element */
import styles from "./booking-ui.module.css";

type BookingHeroProps = {
  brandName: string;
  title: string;
  subtitle: string;
  heroImageUrl: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
  meta: string[];
  mobile?: boolean;
};

export function BookingHero(props: BookingHeroProps) {
  if (props.mobile) {
    return (
      <section className={styles.mobileHeroMedia}>
        {props.heroImageUrl ? <img className={styles.heroImage} src={props.heroImageUrl} alt={props.title} /> : null}
        <div className={styles.mobileHeroContent}>
          <p className={styles.eyebrow}>{props.brandName}</p>
          <h1 className={styles.mobileTitle}>{props.title}</h1>
          <p className={styles.heroSubtle}>{props.subtitle}</p>
          <div className={styles.heroMeta}>
            {props.meta.map((item) => (
              <span key={item} className={styles.metaPill}>
                {item}
              </span>
            ))}
          </div>
          <div className={styles.heroActions}>
            <button type="button" className={styles.ctaButton} onClick={props.onPrimaryClick}>
              {props.primaryLabel}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={props.onSecondaryClick}>
              {props.secondaryLabel}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.hero}>
      <div className={styles.heroPanel}>
        <div>
          <p className={styles.sectionEyebrow}>{props.brandName}</p>
          <h1 className={styles.heroTitle}>{props.title}</h1>
          <p className={styles.heroSubtitle}>{props.subtitle}</p>
        </div>

        <div>
          <div className={styles.heroMeta}>
            {props.meta.map((item) => (
              <span key={item} className={styles.metaPill}>
                {item}
              </span>
            ))}
          </div>
          <div className={styles.heroActions}>
            <button type="button" className={styles.ctaButton} onClick={props.onPrimaryClick}>
              {props.primaryLabel}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={props.onSecondaryClick}>
              {props.secondaryLabel}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.heroMedia}>
        {props.heroImageUrl ? <img className={styles.heroImage} src={props.heroImageUrl} alt={props.title} /> : null}
        <div className={styles.heroOverlay}>
          <p className={styles.eyebrow}>Performance recovery</p>
          <p className={styles.heroSubtle}>{props.subtitle}</p>
        </div>
      </div>
    </section>
  );
}
