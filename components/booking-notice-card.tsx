import styles from "./booking-ui.module.css";

type BookingNoticeCardProps = {
  title: string;
  body: string;
  reminders: string[];
};

export function BookingNoticeCard(props: BookingNoticeCardProps) {
  return (
    <section className={styles.noticeCard}>
      <p className={styles.sectionEyebrow}>Booking notice</p>
      <h2 className={styles.stepTitle}>{props.title}</h2>
      <p className={styles.noticeBody}>{props.body}</p>
      <div className={styles.noticeList}>
        {props.reminders.map((item) => (
          <div key={item} className={styles.noticeItem}>
            <span className={styles.summaryLabel}>Note</span>
            <span className={styles.summaryValue}>{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
