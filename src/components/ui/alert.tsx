import * as React from "react";

import { cn } from "@/lib/utils";

export function Alert({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "destructive";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        variant === "default"
          ? "border-border bg-secondary/70 text-secondary-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive",
        className
      )}
      {...props}
    />
  );
}
