import { cn } from "cn";
import { ForwardRefRenderFunction, PropsWithoutRef, forwardRef } from "react";

export { cn };

// forward refs
export function fr<T = HTMLElement, P = React.HTMLAttributes<T>>(
  component: ForwardRefRenderFunction<T, PropsWithoutRef<P>>
) {
  const wrapped = forwardRef(component);
  wrapped.displayName = component.name;
  return wrapped;
}
