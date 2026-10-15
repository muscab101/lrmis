import Link from "next/link";

// Fallback for paths outside any locale (middleware normally adds the locale).
export default function GlobalNotFound() {
  return (
    <html lang="so">
      <body style={{ fontFamily: "system-ui", padding: 40 }}>
        <h1>404</h1>
        <p>Boggan lama helin · Page not found</p>
        <Link href="/so">Dhulka</Link>
      </body>
    </html>
  );
}
