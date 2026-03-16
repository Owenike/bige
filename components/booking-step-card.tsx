import styles from "./booking-ui.module.css";

type BookingStepCardProps = {
  id?: string;
  title: string;
  description: string;
  status: string;
  children: React.ReactNode;
};

export function BookingStepCard(props: BookingStepCardProps) {
  return (
    <section id={props.id} className={styles.stepCard}>
      <div className={styles.stepHead}>
        <div>
          <h3 className={styles.stepTitle}>{props.title}</h3>
          <p className={styles.stepDescription}>{props.description}</p>
        </div>
        <span className={styles.stepStatus}>{props.status}</span>
      </div>
      <div className={styles.stepBody}>{props.children}</div>
    </section>
  );
}
