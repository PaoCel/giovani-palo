import type { ComponentProps } from "react";

import { AppIcon } from "@/components/AppIcon";
import { cx } from "@/components/ui/cx";
import "@/styles/ui.css";

type IconProps = ComponentProps<typeof AppIcon>;

// AppIcon non ha una dimensione sua e, senza una regola CSS, prende tutto lo
// spazio libero (la freccia di /unit). Icon le dà 1.25em di default; il CSS
// del contesto la sovrascrive.
export function Icon({ className, ...props }: IconProps) {
  return <AppIcon className={cx("ui-icon", className)} {...props} />;
}
