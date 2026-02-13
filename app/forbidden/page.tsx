export default function ForbiddenPage() {
  return (
    <main style={{ padding: 24 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1>Forbidden</h1>
        <p>You do not have access to this page.</p>
        <p>
          <a href="/login">Go to login</a>
        </p>
      </div>
    </main>
  );
}
