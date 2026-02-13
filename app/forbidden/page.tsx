export default function ForbiddenPage() {
  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="card fdGlassPanel">
            <div className="fdEyebrow">ACCESS CONTROL</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Forbidden
            </h1>
            <p className="fdGlassText">You do not have access to this page.</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <a className="fdPillBtn fdPillBtnPrimary" href="/login">Go to login</a>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
