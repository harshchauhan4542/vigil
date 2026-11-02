import type { ReactNode } from 'react';

export const metadata = {
  title: 'Vigil',
  description: 'AI money-ops control room for PayPal merchants',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
