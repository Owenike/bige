export default function FrontdeskPortalPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Frontdesk Portal</h1>
      <ul>
        <li><a href="/frontdesk/checkin">Check-in Scanner</a></li>
        <li><a href="/frontdesk/member-search">Member Search/Create</a></li>
        <li><a href="/frontdesk/orders/new">New Order + Payment</a></li>
        <li><a href="/frontdesk/bookings">Booking Assist</a></li>
        <li><a href="/frontdesk/handover">Shift Handover</a></li>
      </ul>
    </main>
  );
}
