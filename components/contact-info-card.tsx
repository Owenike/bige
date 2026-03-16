import styles from "./booking-ui.module.css";

type ContactInfoCardProps = {
  title: string;
  body: string;
  address: string;
  phone: string;
  email: string;
  line: string;
  hours: Array<{ label: string; value: string }>;
};

export function ContactInfoCard(props: ContactInfoCardProps) {
  return (
    <section className={styles.contactCard} id="contact">
      <p className={styles.sectionEyebrow}>Contact</p>
      <h2 className={styles.stepTitle}>{props.title}</h2>
      <p className={styles.contactBody}>{props.body}</p>

      <div className={styles.contactList}>
        {props.address ? (
          <div className={styles.contactItem}>
            <span className={styles.summaryLabel}>Address</span>
            <span className={styles.summaryValue}>{props.address}</span>
          </div>
        ) : null}
        {props.phone ? (
          <div className={styles.contactItem}>
            <span className={styles.summaryLabel}>Phone</span>
            <a className={styles.contactLink} href={`tel:${props.phone}`}>
              {props.phone}
            </a>
          </div>
        ) : null}
        {props.email ? (
          <div className={styles.contactItem}>
            <span className={styles.summaryLabel}>Email</span>
            <a className={styles.contactLink} href={`mailto:${props.email}`}>
              {props.email}
            </a>
          </div>
        ) : null}
        {props.line ? (
          <div className={styles.contactItem}>
            <span className={styles.summaryLabel}>Line</span>
            <span className={styles.summaryValue}>{props.line}</span>
          </div>
        ) : null}
      </div>

      {props.hours.length > 0 ? (
        <div className={styles.hoursList}>
          {props.hours.map((item) => (
            <div key={item.label} className={styles.hourItem}>
              <span className={styles.summaryLabel}>{item.label}</span>
              <span className={styles.summaryValue}>{item.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
