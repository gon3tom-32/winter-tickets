"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Re-checks the order every 2 seconds for up to 2 minutes while payment is being confirmed. */
export default function RefreshWhilePending() {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > 120_000) {
        clearInterval(id);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, 2000);
    return () => clearInterval(id);
  }, [router]);
  return gaveUp ? (
    <p className="notice">
      This is taking longer than usual. If you paid, you&apos;ll get an email when it&apos;s confirmed. You can also reload
      this page later.
    </p>
  ) : null;
}
