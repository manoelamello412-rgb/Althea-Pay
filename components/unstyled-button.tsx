'use client'

import { Slot } from '@radix-ui/react-slot'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type UnstyledButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
  children?: ReactNode
}

/**
 * Behavior-first button primitive. Radix owns composition/accessibility semantics;
 * visual treatment is deliberately left to the caller or a motion wrapper.
 */
export default function UnstyledButton({ asChild = false, className, children, ...props }: UnstyledButtonProps) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      type={asChild ? undefined : 'button'}
      className={cn('outline-none focus-visible:ring-2 focus-visible:ring-[#1DB854]/50 disabled:pointer-events-none disabled:opacity-50', className)}
      {...props}
    >
      {children}
    </Comp>
  )
}
